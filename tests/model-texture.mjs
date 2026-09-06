import assert from 'node:assert/strict';
import { applyCommand, CommandHistory } from '../src/commands.js';
import { createChestSampleDoc, createPart, createPartTexturePixels, createSampleDoc, createTeapotSampleDoc, deserializeDoc, resizePartTexture, serializeDoc, textureLayout, validateDoc } from '../src/model.js';
import { atlasPixelForVertex } from '../src/uv-layout.js';

const doc = createSampleDoc();
assert.doesNotThrow(() => validateDoc(doc));
assert.deepEqual(doc.parts.map(part => part.name), ['頭', '胴', '左腕', '右腕', '左脚', '右脚']);
for (const part of doc.parts) assert.doesNotThrow(() => createPartTexturePixels(part, doc.palette));
assert.equal(doc.texelsPerUnit, 4);
assert.deepEqual(textureLayout(doc.parts[0], 4).size, [64, 32]);

const chest = createChestSampleDoc();
assert.doesNotThrow(() => validateDoc(chest));
assert.deepEqual(chest.parts.map(part => [part.name, part.size]), [
  ['本体', [10, 6, 6]],
  ['蓋', [10, 2, 8]],
  ['錠前', [2, 2, 2]],
]);
assert.ok(chest.parts.every(part => part.type === 'box'));
assert.ok(chest.parts.every(part => chest.palette.includes(part.color)));

const teapot = createTeapotSampleDoc();
assert.doesNotThrow(() => validateDoc(teapot));
assert.deepEqual(teapot.parts.map(part => part.name), [
  '本体', '蓋', 'つまみ', '注ぎ口（根元）', '注ぎ口（先端）', '取っ手（上）', '取っ手（外）', '取っ手（下）',
]);
assert.ok(teapot.parts.every(part => ['box', 'cylinder'].includes(part.type)));
assert.ok(teapot.parts.every(part => part.rotation.every(angle => angle % 15 === 0)));
assert.ok(teapot.parts.every(part => teapot.palette.includes(part.color)));
assert.ok(teapot.parts.every(part => part.texture.rows.every(row => /^\.+$/.test(row))));

const box = { type: 'box', size: [4, 6, 2] };
const boxLayout = textureLayout(box, 4);
const faceTopLeftVertices = {
  right: [[2, 3, 1], [1, 0, 0]], left: [[-2, 3, -1], [-1, 0, 0]],
  up: [[-2, 3, -1], [0, 1, 0]], down: [[-2, -3, 1], [0, -1, 0]],
  front: [[-2, 3, 1], [0, 0, 1]], back: [[2, 3, -1], [0, 0, -1]],
};
const debugRows = Array.from({ length: boxLayout.size[1] }, () => Array(boxLayout.size[0]).fill('.'));
const faceColors = { up: '0', down: '1', right: '2', front: '3', left: '4', back: '5' };
for (const [face, [x, y, width, height]] of Object.entries(boxLayout.faces)) {
  for (let py = y; py < y + height; py++) for (let px = x; px < x + width; px++) debugRows[py][px] = faceColors[face];
}
for (const [face, [position, normal]] of Object.entries(faceTopLeftVertices)) {
  assert.deepEqual(atlasPixelForVertex(box, boxLayout, position, normal, [0, 0], 4), [face, 0, 0]);
  const [regionX, regionY] = boxLayout.faces[face];
  // 各面を別色にした場合、左上頂点が必ずその面色の領域へ入る。
  assert.equal(regionX + atlasPixelForVertex(box, boxLayout, position, normal, [0, 0], 4)[1], regionX);
  assert.equal(regionY + atlasPixelForVertex(box, boxLayout, position, normal, [0, 0], 4)[2], regionY);
}
const faceCenters = {
  right: [[2, 0, 0], [1, 0, 0]], left: [[-2, 0, 0], [-1, 0, 0]],
  up: [[0, 3, 0], [0, 1, 0]], down: [[0, -3, 0], [0, -1, 0]],
  front: [[0, 0, 1], [0, 0, 1]], back: [[0, 0, -1], [0, 0, -1]],
};
for (const [face, [position, normal]] of Object.entries(faceCenters)) {
  const [, localX, localY] = atlasPixelForVertex(box, boxLayout, position, normal, [.5, .5], 4);
  const [regionX, regionY] = boxLayout.faces[face];
  assert.equal(debugRows[regionY + localY][regionX + localX], faceColors[face]);
}

const cylinder = createPart(doc, 'cylinder');
const cylinderLayout = textureLayout(cylinder, 4);
assert.deepEqual(cylinderLayout.size, [51, 32]);
assert.deepEqual(atlasPixelForVertex(cylinder, cylinderLayout, [0, 2, -2], [0, 1, 0], [.5, .5], 4), ['up', 8, 0]);
assert.deepEqual(atlasPixelForVertex(cylinder, cylinderLayout, [0, -2, 2], [0, -1, 0], [.5, .5], 4), ['down', 8, 0]);
assert.deepEqual(atlasPixelForVertex(cylinder, cylinderLayout, [2, 2, 0], [1, 0, 0], [0, 1], 4), ['side', 0, 0]);

const legacy = deserializeDoc(JSON.stringify({ version: 1, name: 'old', grid: 1, parts: [{ ...cylinder, texture: undefined }] }));
assert.equal(legacy.texelsPerUnit, 4);
assert.equal(legacy.palette.length, 8);
assert.equal(legacy.parts[0].texture, undefined);
assert.doesNotThrow(() => createPartTexturePixels(legacy.parts[0], legacy.palette));
assert.equal(createPartTexturePixels(legacy.parts[0], legacy.palette), null);

const textured = createPart(doc, 'box');
textured.texture.rows[0] = `1${textured.texture.rows[0].slice(1)}`;
assert.doesNotThrow(() => createPartTexturePixels(textured, doc.palette));
assert.equal(createPartTexturePixels(textured, doc.palette).pixels[0], doc.palette[1]);
const source = { ...doc, parts: [textured] };
const grown = applyCommand(source, { type: 'setTransform', partId: textured.id, transform: { size: [3, 5, 2] } });
assert.deepEqual(grown.parts[0].texture.size, [40, 28]);
assert.equal(grown.parts[0].texture.rows[0][0], '1');

const shrunk = structuredClone(grown.parts[0]);
shrunk.texture.rows[27] = `${shrunk.texture.rows[27].slice(0, 39)}1`;
shrunk.size = [1, 1, 1];
assert.equal(resizePartTexture(shrunk, 4), true);
assert.deepEqual(shrunk.texture.size, [16, 8]);

assert.throws(() => validateDoc({
  ...doc,
  palette: ['#000000'],
  parts: [{ ...createPart(doc, 'box'), texture: { size: [32, 24], rows: Array(24).fill('1'.repeat(32)) } }],
}), /パレット範囲外/);

const history = new CommandHistory();
const changed = history.execute(source, { type: 'setTransform', partId: textured.id, transform: { size: [3, 5, 2] } });
assert.deepEqual(history.undo(changed), source);
assert.deepEqual(history.redo(source), changed);
assert.deepEqual(deserializeDoc(serializeDoc(changed)), changed);

const paintSource = structuredClone(source);
const paintCommand = { type: 'paintPixels', partId: textured.id, pixels: [[2, 3, '1'], [2, 3, '2'], [4, 5, '3']] };
const paintCommandBefore = structuredClone(paintCommand);
const painted = applyCommand(paintSource, paintCommand);
assert.equal(painted.parts[0].texture.rows[3][2], '2', '同じ座標では最後の値を採用する');
assert.equal(painted.parts[0].texture.rows[5][4], '3');
assert.deepEqual(paintCommand, paintCommandBefore, 'コマンド入力を書き換えない');
assert.deepEqual(paintSource, source, '元のdocを書き換えない');

const paintHistory = new CommandHistory();
const oncePainted = paintHistory.execute(paintSource, paintCommand);
assert.equal(paintHistory.past.length, 1, '1ストロークを履歴1件にする');
assert.deepEqual(paintHistory.undo(oncePainted), paintSource, 'Undoでストローク前へ戻る');
const unchanged = paintHistory.execute(paintSource, { type: 'paintPixels', partId: textured.id, pixels: [[0, 0, '1'], [0, 0, '1']] });
assert.equal(unchanged, paintSource, '変化がないときは元のdocを返す');
assert.equal(paintHistory.past.length, 0, '変化がないときは履歴を発行しない');
const textureless = { ...doc, parts: [{ ...structuredClone(textured), texture: undefined }] };
const erasedBlank = new CommandHistory();
assert.equal(erasedBlank.execute(textureless, { type: 'paintPixels', partId: textured.id, pixels: [[0, 0, '.']] }), textureless);
assert.equal(erasedBlank.past.length, 0, 'textureなしの空ピクセル消去も履歴を発行しない');

console.log('model texture tests: OK');
