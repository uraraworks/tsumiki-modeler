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
  '本体', '蓋', 'つまみ', '注ぎ口（根元）', '注ぎ口（中間）', '注ぎ口（先端）', '取っ手（上）', '取っ手（外）', '取っ手（下）',
]);
assert.ok(teapot.parts.every(part => ['box', 'cylinder'].includes(part.type)));
assert.ok(teapot.parts.every(part => part.rotation.every(angle => angle % 15 === 0)));
assert.ok(teapot.parts.every(part => teapot.palette.includes(part.color)));
assert.ok(teapot.parts.every(part => part.texture.rows.every(row => /^\.+$/.test(row))));
const teapotPart = name => teapot.parts.find(part => part.name === name);
const boxEndpoints = (part) => {
  const angle = part.rotation[2] * Math.PI / 180;
  const offset = [part.size[0] / 2 * Math.cos(angle), part.size[0] / 2 * Math.sin(angle)];
  return [
    [part.position[0] - offset[0], part.position[1] - offset[1]],
    [part.position[0] + offset[0], part.position[1] + offset[1]],
  ];
};
const distance2d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const rootEnds = boxEndpoints(teapotPart('注ぎ口（根元）'));
const middleEnds = boxEndpoints(teapotPart('注ぎ口（中間）'));
const tipEnds = boxEndpoints(teapotPart('注ぎ口（先端）'));
assert.deepEqual(['注ぎ口（根元）', '注ぎ口（中間）', '注ぎ口（先端）'].map(name => {
  const part = teapotPart(name);
  return [part.position, part.size, part.rotation];
}), [
  [[3, 4, 0], [2, 3, 3], [0, 0, 15]],
  [[4, 5, 0], [2, 2, 2], [0, 0, 30]],
  [[5, 6, 0], [2, 1, 1], [0, 0, 45]],
]);
assert.ok(3 - rootEnds[0][0] > .9 && 3 - rootEnds[0][0] < 1, '注ぎ口の根元が本体側面へ入る');
assert.ok(distance2d(rootEnds[1], middleEnds[0]) < .9, '注ぎ口の根元と中間が接続する');
assert.ok(distance2d(middleEnds[1], tipEnds[0]) < .7, '注ぎ口の中間と先端が接続する');
assert.deepEqual(['取っ手（上）', '取っ手（外）', '取っ手（下）'].map(name => {
  const part = teapotPart(name);
  return [part.position, part.size, part.rotation];
}), [
  [[-4, 6, 0], [3, 1, 2], [0, 0, -30]],
  [[-5, 4, 0], [1, 5, 2], [0, 0, 0]],
  [[-4, 2, 0], [3, 1, 2], [0, 0, 30]],
]);
for (const name of ['取っ手（上）', '取っ手（下）']) {
  const [, bodyEnd] = boxEndpoints(teapotPart(name));
  assert.ok(bodyEnd[0] + 3 > .25 && bodyEnd[0] + 3 < .4, `${name}が本体側面へ浅く入る`);
  assert.ok(bodyEnd[1] >= 1 && bodyEnd[1] <= 7, `${name}が本体の高さ内で接続する`);
}
const handleOuter = teapotPart('取っ手（外）');
const upperOuterEnd = boxEndpoints(teapotPart('取っ手（上）'))[0];
const lowerOuterEnd = boxEndpoints(teapotPart('取っ手（下）'))[0];
assert.ok(Math.abs(upperOuterEnd[0] - handleOuter.position[0]) < handleOuter.size[0] / 2 && upperOuterEnd[1] - (handleOuter.position[1] + handleOuter.size[1] / 2) < .5, '取っ手上部と外側が接続する');
assert.ok(Math.abs(lowerOuterEnd[0] - handleOuter.position[0]) < handleOuter.size[0] / 2 && (handleOuter.position[1] - handleOuter.size[1] / 2) - lowerOuterEnd[1] < .5, '取っ手下部と外側が接続する');
const body = teapotPart('本体'), lid = teapotPart('蓋'), knob = teapotPart('つまみ');
assert.equal(body.position[1] + body.height / 2 - (lid.position[1] - lid.height / 2), .5, '蓋が本体上面へ0.5重なる');
assert.equal(lid.position[1] + lid.height / 2 - (knob.position[1] - knob.height / 2), .5, 'つまみが蓋上面へ0.5重なる');
const partBounds = teapot.parts.map(part => {
  if (part.type === 'cylinder') return [[part.position[0] - part.radius, part.position[1] - part.height / 2, part.position[2] - part.radius], [part.position[0] + part.radius, part.position[1] + part.height / 2, part.position[2] + part.radius]];
  const angle = part.rotation[2] * Math.PI / 180;
  const halfX = Math.abs(part.size[0] / 2 * Math.cos(angle)) + Math.abs(part.size[1] / 2 * Math.sin(angle));
  const halfY = Math.abs(part.size[0] / 2 * Math.sin(angle)) + Math.abs(part.size[1] / 2 * Math.cos(angle));
  return [[part.position[0] - halfX, part.position[1] - halfY, part.position[2] - part.size[2] / 2], [part.position[0] + halfX, part.position[1] + halfY, part.position[2] + part.size[2] / 2]];
});
const overallSize = [0, 1, 2].map(axis => Math.max(...partBounds.map(bounds => bounds[1][axis])) - Math.min(...partBounds.map(bounds => bounds[0][axis])));
assert.ok(Math.max(...partBounds.slice(3, 6).map(bounds => bounds[1][0])) <= 7, '注ぎ口が本体中心からx=7以内に収まる');
assert.ok(overallSize[0] <= 12 && overallSize[1] <= 14 && overallSize[2] <= 14, '全体が約12×14×14グリッド内に収まる');

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
