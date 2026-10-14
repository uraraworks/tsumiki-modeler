// 単色モード（colorMode）・単位（unitCm）・スナップ刻み（grid）のコマンドと互換性のテスト。
import assert from 'node:assert/strict';
import { applyCommand, CommandHistory } from '../src/commands.js';
import { createNewDoc, createSampleDoc, createChestSampleDoc, deserializeDoc, hasPaintedTexture, isSolidPart, modelExtent, serializeDoc, validateDoc } from '../src/model.js';
import { textureSignature } from '../src/texture.js';

// --- 既存データの互換性：新フィールドを足していない文書は何も変わらない ---
for (const create of [createNewDoc, createSampleDoc, createChestSampleDoc]) {
  const doc = create();
  assert.equal(doc.unitCm, undefined, '既存サンプルはunitCmを持たない');
  assert.ok(doc.parts.every(part => part.colorMode === undefined), '既存サンプルはcolorModeを持たない');
  assert.deepEqual(deserializeDoc(serializeDoc(doc)), doc, 'JSONの往復で変わらない');
}
// colorMode無しのテクスチャ付きパーツは従来どおり（空テクスチャでも texture があればテクスチャ扱い）
const legacy = createNewDoc();
assert.equal(isSolidPart(legacy.parts[0]), false);
assert.equal(hasPaintedTexture(legacy.parts[0]), false);
assert.notEqual(textureSignature(legacy.parts[0], legacy.palette), null, '従来のパーツはテクスチャ署名を持つ');

// --- setSolidColor / setColorMode ---
let doc = createNewDoc();
const id = doc.parts[0].id;
doc = applyCommand(doc, { type: 'setSolidColor', partId: id, color: '#12ab9f' });
assert.equal(doc.parts[0].color, '#12ab9f', 'パレット外の任意色を設定できる');
assert.equal(doc.parts[0].colorMode, 'solid');
assert.ok(doc.parts[0].texture, '単色にしてもテクスチャは保持する（戻せる）');
assert.equal(textureSignature(doc.parts[0], doc.palette), null, '単色モードはテクスチャを使わない');
doc = applyCommand(doc, { type: 'setColorMode', partId: id, mode: 'texture' });
assert.equal(doc.parts[0].colorMode, 'texture');
assert.notEqual(textureSignature(doc.parts[0], doc.palette), null);
assert.throws(() => applyCommand(doc, { type: 'setColorMode', partId: id, mode: 'metal' }), /solid/);
assert.throws(() => applyCommand(doc, { type: 'setSolidColor', partId: id, color: 'red' }), /#rrggbb/);
assert.throws(() => applyCommand(doc, { type: 'setColorMode', partId: 'nope', mode: 'solid' }), /見つかりません/);
assert.throws(() => validateDoc({ ...doc, parts: [{ ...doc.parts[0], colorMode: 'bad' }] }), /colorMode/);

// --- addPart の colorMode:"solid" はテクスチャを作らない。描くと自動でテクスチャモードへ ---
doc = createNewDoc();
doc = applyCommand(doc, { type: 'addPart', part: { name: '葉', type: 'box', colorMode: 'solid', color: '#4f9440', size: [8, 1, 6], position: [0, 5, 0] } });
const leaf = doc.parts.at(-1);
assert.equal(leaf.texture, undefined, 'solid指定のaddPartはテクスチャを作らない');
assert.equal(isSolidPart(leaf), true);
doc = applyCommand(doc, { type: 'paintPixels', partId: leaf.id, pixels: [[0, 0, '1']] });
const painted = doc.parts.find(part => part.id === leaf.id);
assert.equal(painted.colorMode, 'texture', '単色パーツへ描くとテクスチャモードへ切り替わる');
assert.equal(hasPaintedTexture(painted), true);
// colorModeを渡さないaddPartは従来どおりテクスチャを作る
doc = applyCommand(doc, { type: 'addPart', part: { name: '箱', type: 'box' } });
assert.ok(doc.parts.at(-1).texture);

// --- Undo/Redo（コマンド経由であること） ---
const history = new CommandHistory();
let current = createNewDoc();
current = history.execute(current, { type: 'setSolidColor', partId: current.parts[0].id, color: '#ff0000' });
current = history.execute(current, { type: 'setUnit', unitCm: 2.5 });
current = history.execute(current, { type: 'setGrid', grid: 5 });
assert.equal(current.unitCm, 2.5); assert.equal(current.grid, 5);
current = history.undo(current); assert.equal(current.grid, 1);
current = history.undo(current); assert.equal(current.unitCm, undefined);
current = history.undo(current); assert.equal(current.parts[0].colorMode, undefined);
current = history.redo(current); assert.equal(current.parts[0].colorMode, 'solid');

// --- 単位・刻み ---
doc = createNewDoc();
assert.equal(applyCommand(doc, { type: 'setUnit', unitCm: 1 }).unitCm, 1);
assert.equal(applyCommand(applyCommand(doc, { type: 'setUnit', unitCm: 1 }), { type: 'setUnit', unitCm: null }).unitCm, undefined, 'nullで換算なしに戻る');
assert.throws(() => applyCommand(doc, { type: 'setUnit', unitCm: 0 }), /unitCm/);
assert.throws(() => applyCommand(doc, { type: 'setUnit', unitCm: -1 }), /unitCm/);
assert.throws(() => applyCommand(doc, { type: 'setUnit', unitCm: 'abc' }), /unitCm/);
assert.equal(applyCommand(doc, { type: 'setGrid', grid: 10 }).grid, 10);
assert.throws(() => applyCommand(doc, { type: 'setGrid', grid: 0 }), /grid/);
assert.throws(() => applyCommand(doc, { type: 'setGrid', grid: 1.5 }), /grid/);

// --- modelExtent：1単位＝1cmで120単位の株は1.2m ---
let plant = { ...createNewDoc(), unitCm: 1, parts: [] };
plant = applyCommand(plant, { type: 'addPart', part: { name: '茎', type: 'cylinder', radius: 1, height: 120, position: [0, 60, 0], colorMode: 'solid' } });
plant = applyCommand(plant, { type: 'addPart', part: { name: '葉', type: 'box', size: [10, 1, 6], position: [8, 80, 0], rotation: [0, 0, 0], colorMode: 'solid' } });
const extent = modelExtent(plant);
assert.deepEqual(extent.min.map(Math.round), [-1, 0, -3]);
assert.equal(Math.round(extent.size[1]), 120);
assert.equal(extent.size[1] * plant.unitCm / 100, 1.2, '120単位×1cm＝1.2m');
assert.equal(modelExtent({ ...plant, parts: [] }), null);
// 回転した箱：z軸90度で幅と高さが入れ替わる
const rotated = applyCommand({ ...createNewDoc(), parts: [] }, { type: 'addPart', part: { name: 'r', type: 'box', size: [10, 2, 2], position: [0, 0, 0], rotation: [0, 0, 90] } });
assert.deepEqual(modelExtent(rotated).size.map(value => Math.round(value)), [2, 10, 2]);

console.log('solid-color-unit: ok');
