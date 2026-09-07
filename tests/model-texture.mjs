import assert from 'node:assert/strict';
import { applyCommand, CommandHistory } from '../src/commands.js';
import { applyAnimationFrame, calculateBoneWorldTransforms, createBlankTexture, createBone, createChestSampleDoc, createNewDoc, createPart, createPartTexturePixels, createSampleDoc, createTeapotSampleDoc, deserializeDoc, duplicatePart, interpolateRotation, mirrorPart, resizePartTexture, serializeDoc, textureLayout, validateDoc } from '../src/model.js';
import { atlasPixelForVertex } from '../src/uv-layout.js';
import { validateModelReport } from '../src/model-validation.js';
import { calculatePartBounds, createPartGeometry, resizeDimensions, resizeHandleLayout, resizePreviewScale } from '../src/geometry.js';

const doc = createSampleDoc();
assert.doesNotThrow(() => validateDoc(doc));
assert.deepEqual(doc.parts.map(part => part.name), ['頭', '胴', '左腕', '右腕', '左脚', '右脚']);
assert.deepEqual(doc.bones.map(bone => [bone.name, bone.parent]), [
  ['腰', null], ['胴', 'b1'], ['頭', 'b2'], ['左腕', 'b2'], ['右腕', 'b2'], ['左脚', 'b1'], ['右脚', 'b1'],
]);
assert.deepEqual(doc.parts.map(part => [part.name, part.bone]), [
  ['頭', 'b3'], ['胴', 'b2'], ['左腕', 'b4'], ['右腕', 'b5'], ['左脚', 'b6'], ['右脚', 'b7'],
]);
assert.equal(doc.animations.length, 1);
assert.equal(doc.animations[0].name, 'walk');
assert.doesNotThrow(() => validateDoc(doc), '人型の歩行アニメーションがModelDocとして有効');
for (const part of doc.parts) assert.doesNotThrow(() => createPartTexturePixels(part, doc.palette));
assert.equal(doc.texelsPerUnit, 4);
assert.deepEqual(textureLayout(doc.parts[0], 4).size, [64, 32]);

const newDoc = createNewDoc();
assert.doesNotThrow(() => validateDoc(newDoc), '新規モデルがModelDocとして有効');
assert.equal(newDoc.name, 'untitled');
assert.deepEqual(newDoc.parts.map(part => [part.name, part.type, part.position]), [['箱 1', 'box', [0, 2, 0]]]);

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
  '本体', '台座', '蓋', 'つまみ', '注ぎ口', '取っ手（上）', '取っ手（外）', '取っ手（下）',
]);
assert.ok(teapot.parts.some(part => part.type === 'sphere'));
assert.ok(teapot.parts.some(part => part.type === 'capsule'));
assert.ok(teapot.parts.some(part => part.type === 'cylinder' && part.radiusTop !== part.radiusBottom));
assert.ok(teapot.parts.every(part => part.rotation.every(angle => angle % 15 === 0)));
assert.ok(teapot.parts.every(part => teapot.palette.includes(part.color)));
assert.ok(teapot.parts.every(part => part.texture.rows.every(row => /^\.+$/.test(row))));
const teapotPart = name => teapot.parts.find(part => part.name === name);
assert.deepEqual([teapotPart('本体').type, teapotPart('本体').radius], ['sphere', 4]);
assert.deepEqual([teapotPart('注ぎ口').type, teapotPart('注ぎ口').radiusTop, teapotPart('注ぎ口').radiusBottom], ['cylinder', 1, 2]);
assert.ok(['取っ手（上）', '取っ手（外）', '取っ手（下）'].every(name => teapotPart(name).type === 'capsule'));

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

const frustum = createPart(doc, 'frustum');
const sphere = createPart(doc, 'sphere');
const capsule = createPart(doc, 'capsule');
assert.deepEqual([frustum.type, frustum.radiusTop, frustum.radiusBottom], ['cylinder', 1, 2]);
assert.deepEqual([sphere.type, sphere.radius, sphere.segments], ['sphere', 2, 10]);
assert.deepEqual([capsule.type, capsule.radius, capsule.height], ['capsule', 2, 4]);
for (const part of [frustum, sphere, capsule]) assert.doesNotThrow(() => validateDoc({ ...doc, parts: [part] }));
const cone = { ...structuredClone(frustum), radiusTop: 0 };
cone.texture = createBlankTexture(cone, doc.texelsPerUnit);
assert.doesNotThrow(() => validateDoc({ ...doc, parts: [cone] }), 'radiusTop: 0を円錐として許可する');
assert.throws(() => validateDoc({ ...doc, parts: [{ ...cone, radiusBottom: 0 }] }), /同時に0/);
assert.deepEqual(textureLayout(sphere, 4).faces.surface, [0, 0, 51, 16]);
assert.deepEqual(textureLayout(capsule, 4).faces.surface, [0, 0, 51, 32]);
assert.deepEqual(atlasPixelForVertex(sphere, textureLayout(sphere, 4), [0, 2, 0], [0, 1, 0], [.25, .75], 4), ['surface', 12.75, 4]);

// 各形状が実際に使う寸法フィールドだけを持つfixtureで、横断処理の回帰を防ぐ。
const primitiveBase = { position: [0, 0, 0], rotation: [0, 0, 0], color: '#e0a070', bone: null };
const primitives = [
  { ...primitiveBase, id: 'shape-box', name: '箱', type: 'box', size: [4, 6, 2] },
  { ...primitiveBase, id: 'shape-cylinder', name: '円柱', type: 'cylinder', radius: 2, height: 4, segments: 8 },
  { ...primitiveBase, id: 'shape-frustum', name: '円錐台', type: 'cylinder', radius: 2, radiusTop: 1, radiusBottom: 3, height: 4, segments: 8 },
  { ...primitiveBase, id: 'shape-sphere', name: '球', type: 'sphere', radius: 2, segments: 10 },
  { ...primitiveBase, id: 'shape-capsule', name: 'カプセル', type: 'capsule', radius: 2, height: 4, segments: 8 },
];
for (const primitive of primitives) {
  assert.doesNotThrow(() => { primitive.texture = createBlankTexture(primitive, doc.texelsPerUnit); }, `${primitive.name}: テクスチャ生成`);
  const primitiveDoc = { ...newDoc, parts: [primitive] };
  assert.doesNotThrow(() => validateDoc(primitiveDoc), `${primitive.name}: validateDoc`);
  assert.doesNotThrow(() => createPartTexturePixels(primitive, doc.palette), `${primitive.name}: テクスチャピクセル生成`);
  assert.doesNotThrow(() => resizeHandleLayout(primitive), `${primitive.name}: 面ハンドル計算`);
  assert.doesNotThrow(() => resizePreviewScale(primitive), `${primitive.name}: 面ハンドルのプレビュー倍率計算`);
  const layout = textureLayout(primitive, doc.texelsPerUnit);
  const uvNormal = primitive.type === 'box' ? [1, 0, 0] : primitive.type === 'cylinder' ? [0, 0, 1] : [0, 1, 0];
  assert.doesNotThrow(() => atlasPixelForVertex(primitive, layout, [0, 0, 0], uvNormal, [.5, .5], doc.texelsPerUnit), `${primitive.name}: UVレイアウト計算`);
  assert.ok(atlasPixelForVertex(primitive, layout, [0, 0, 0], uvNormal, [.5, .5], doc.texelsPerUnit), `${primitive.name}: UV領域あり`);
  assert.doesNotThrow(() => calculatePartBounds(primitive), `${primitive.name}: バウンディングボックス計算`);
  const duplicated = duplicatePart(primitiveDoc, primitive);
  const mirrored = mirrorPart({ ...primitiveDoc, parts: [primitive, duplicated] }, { ...primitive, position: [3, 0, 0] });
  assert.doesNotThrow(() => validateDoc({ ...primitiveDoc, parts: [primitive, duplicated, mirrored] }), `${primitive.name}: 複製・左右ミラー`);
  assert.equal(mirrored.position[0], -3);
}
assert.equal(atlasPixelForVertex(sphere, { size: [1, 1], faces: {} }, [0, 0, 0], [0, 1, 0], [.5, .5], 4), null, '未定義UV領域はテクスチャ無し扱い');
assert.deepEqual(primitives.map(part => resizePreviewScale(part, resizeDimensions(part))), primitives.map(() => [1, 1, 1]));
const resizeTransforms = [
  { size: [6, 6, 2] }, { height: 6 }, { radiusTop: 2 }, { radius: 3 }, { height: 6 },
];
primitives.forEach((primitive, index) => assert.doesNotThrow(() => applyCommand(
  { ...newDoc, parts: [primitive] },
  { type: 'setTransform', partId: primitive.id, transform: resizeTransforms[index] },
), `${primitive.name}: プロパティ編集とテクスチャリサイズ`));
assert.deepEqual(primitives.map(calculatePartBounds), [
  { min: [-2, -3, -1], max: [2, 3, 1] },
  { min: [-2, -2, -2], max: [2, 2, 2] },
  { min: [-3, -2, -3], max: [3, 2, 3] },
  { min: [-2, -2, -2], max: [2, 2, 2] },
  { min: [-2, -4, -2], max: [2, 4, 2] },
]);
assert.deepEqual(resizeHandleLayout(primitives[0]).map(handle => handle.position), [[-2, 0, 0], [2, 0, 0], [0, -3, 0], [0, 3, 0], [0, 0, -1], [0, 0, 1]]);
assert.deepEqual(resizeHandleLayout(primitives[1]).map(handle => handle.position), [[-2, 0, 0], [2, 0, 0], [0, -2, 0], [0, 2, 0], [0, 0, -2], [0, 0, 2]]);
assert.deepEqual(resizeHandleLayout(primitives[2]).map(handle => handle.position), [
  [0, -2, 0], [0, 2, 0], [-1, 2, 0], [-3, -2, 0], [1, 2, 0], [3, -2, 0], [0, 2, -1], [0, -2, -3], [0, 2, 1], [0, -2, 3],
]);
assert.deepEqual(resizeHandleLayout(primitives[3]).map(handle => handle.position), [[-2, 0, 0], [2, 0, 0], [0, -2, 0], [0, 2, 0], [0, 0, -2], [0, 0, 2]]);
assert.deepEqual(resizeHandleLayout(primitives[4]).map(handle => handle.position), [[-2, 0, 0], [2, 0, 0], [0, -4, 0], [0, 4, 0], [0, 0, -2], [0, 0, 2]]);

const geometryCalls = [];
const geometryStub = name => class { constructor(...args) { this.name = name; this.args = args; geometryCalls.push([name, args]); } };
class Vector3Stub { constructor(...values) { this.values = values; } }
class Box3Stub { constructor(min, max) { this.min = min; this.max = max; } }
const fakeThree = {
  BoxGeometry: geometryStub('box'), CylinderGeometry: geometryStub('cylinder'),
  SphereGeometry: geometryStub('sphere'), CapsuleGeometry: geometryStub('capsule'),
  Vector3: Vector3Stub, Box3: Box3Stub,
};
assert.deepEqual(createPartGeometry(cylinder, fakeThree).args, [2, 2, 4, 8, 1], '旧円柱はradiusを上下へ渡す');
assert.deepEqual(createPartGeometry(cone, fakeThree).args, [0, 2, 4, 8, 1], '円錐台の上下半径を個別に渡す');
const sphereGeometry = createPartGeometry(sphere, fakeThree);
assert.deepEqual(sphereGeometry.args, [2, 10, 5]);
assert.deepEqual([sphereGeometry.boundingBox.min.values, sphereGeometry.boundingBox.max.values], [[-2, -2, -2], [2, 2, 2]], 'render_preview用geometryに形状別boundsを設定する');
assert.deepEqual(createPartGeometry(capsule, fakeThree).args, [2, 4, 8, 8]);

const legacy = deserializeDoc(JSON.stringify({ version: 1, name: 'old', grid: 1, parts: [{ ...cylinder, texture: undefined }] }));
assert.equal(legacy.texelsPerUnit, 4);
assert.equal(legacy.palette.length, 8);
assert.equal(legacy.parts[0].texture, undefined);
assert.deepEqual(legacy.bones, []);
assert.deepEqual(legacy.animations, []);
assert.equal(legacy.parts[0].bone, null);
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

const cycleDoc = structuredClone(doc);
cycleDoc.bones.find(bone => bone.id === 'b1').parent = 'b3';
assert.throws(() => validateDoc(cycleDoc), /循環参照/);

const fkDoc = {
  ...structuredClone(doc), parts: [], animations: [], bones: [
    { id: 'root', name: 'root', parent: null, position: [1, 2, 0], rotation: [0, 0, 90] },
    { id: 'child', name: 'child', parent: 'root', position: [2, 0, 0], rotation: [0, 0, 0] },
  ],
};
const fk = calculateBoneWorldTransforms(validateDoc(fkDoc));
assert.ok(Math.abs(fk.get('child').position[0] - 1) < 1e-10);
assert.ok(Math.abs(fk.get('child').position[1] - 4) < 1e-10, '親の90度回転で子の相対XがワールドYへ向く');
assert.ok(Math.abs(fk.get('child').matrix[0]) < 1e-10 && Math.abs(fk.get('child').matrix[1] - 1) < 1e-10, '子の最終姿勢へ親の回転を合成する');

const commandBase = createChestSampleDoc();
const minimalPartDoc = applyCommand(commandBase, {
  type: 'addPart',
  part: { name: '頭', type: 'box', position: [0, 12, 0], size: [4, 4, 4] },
});
const minimalPart = minimalPartDoc.parts.at(-1);
assert.deepEqual(minimalPart, {
  id: 'p4', name: '頭', type: 'box', position: [0, 12, 0], size: [4, 4, 4],
  radius: 2, height: 4, segments: 8, rotation: [0, 0, 0], color: commandBase.palette[0], bone: null,
  texture: createBlankTexture({ type: 'box', size: [4, 4, 4] }, commandBase.texelsPerUnit),
}, '最小フィールドのaddPartへcreatePart相当の既定値を補完する');
assert.equal(minimalPart.bone, null, 'bone未指定はnullにする');
assert.throws(() => applyCommand(commandBase, {
  type: 'addPart',
  part: { name: '不正ボーン', type: 'box', position: [0, 0, 0], size: [2, 2, 2], bone: 'missing' },
}), /不正ボーンの所属ボーンが見つかりません/);
const addedBone = createBone(commandBase, null);
const minimalBoneDoc = applyCommand(commandBase, { type: 'addBone', bone: {} });
assert.deepEqual(minimalBoneDoc.bones.at(-1), {
  id: 'b1', name: 'ボーン 1', parent: null, position: [0, 0, 0], rotation: [0, 0, 0],
}, 'addBoneの省略可能フィールドへcreateBone相当の既定値を補完する');
const boneHistory = new CommandHistory();
const withBone = boneHistory.execute(commandBase, { type: 'addBone', bone: addedBone });
assert.equal(withBone.bones.length, 1);
assert.deepEqual(boneHistory.undo(withBone), commandBase, 'addBoneをUndoできる');
let commandDoc = applyCommand(commandBase, { type: 'addBone', bone: addedBone });
commandDoc = applyCommand(commandDoc, { type: 'renameBone', boneId: addedBone.id, name: 'root' });
assert.equal(commandDoc.bones[0].name, 'root');
commandDoc = applyCommand(commandDoc, { type: 'setBoneTransform', boneId: addedBone.id, transform: { position: [1, 2, 3], rotation: [15, 30, 45] } });
assert.deepEqual(commandDoc.bones[0].position, [1, 2, 3]);
const childBone = { ...createBone(commandDoc, null), parent: addedBone.id };
commandDoc = applyCommand(commandDoc, { type: 'addBone', bone: childBone });
commandDoc = applyCommand(commandDoc, { type: 'setBoneParent', boneId: childBone.id, parent: null });
assert.equal(commandDoc.bones.find(bone => bone.id === childBone.id).parent, null);
commandDoc = applyCommand(commandDoc, { type: 'assignPartBone', partId: commandDoc.parts[0].id, boneId: addedBone.id });
assert.equal(commandDoc.parts[0].bone, addedBone.id);
const removeHistory = new CommandHistory();
const removed = removeHistory.execute(commandDoc, { type: 'removeBone', boneId: addedBone.id });
assert.equal(removed.parts[0].bone, null);
assert.deepEqual(removeHistory.undo(removed), commandDoc, 'removeBoneと割り当て解除をまとめてUndoできる');
const subtreeDoc = applyCommand(commandDoc, { type: 'setBoneParent', boneId: childBone.id, parent: addedBone.id });
const assignedToChild = applyCommand(subtreeDoc, { type: 'assignPartBone', partId: subtreeDoc.parts[1].id, boneId: childBone.id });
const removedSubtree = applyCommand(assignedToChild, { type: 'removeBone', boneId: addedBone.id });
assert.deepEqual(removedSubtree.bones, [], '子孫ボーンもまとめて削除する');
assert.equal(removedSubtree.parts[1].bone, null, '子孫ボーン所属のパーツも解除する');

const parentHistory = new CommandHistory();
const reparented = parentHistory.execute(commandDoc, { type: 'setBoneParent', boneId: childBone.id, parent: addedBone.id });
assert.deepEqual(parentHistory.undo(reparented), commandDoc, 'setBoneParentをUndoできる');
const transformHistory = new CommandHistory();
const transformedBone = transformHistory.execute(commandDoc, { type: 'setBoneTransform', boneId: addedBone.id, transform: { rotation: [0, 0, 90] } });
assert.deepEqual(transformHistory.undo(transformedBone), commandDoc, 'setBoneTransformをUndoできる');
const renameHistory = new CommandHistory();
const renamedBone = renameHistory.execute(commandDoc, { type: 'renameBone', boneId: addedBone.id, name: 'renamed' });
assert.deepEqual(renameHistory.undo(renamedBone), commandDoc, 'renameBoneをUndoできる');
const assignHistory = new CommandHistory();
const unassigned = assignHistory.execute(commandDoc, { type: 'assignPartBone', partId: commandDoc.parts[0].id, boneId: null });
assert.deepEqual(assignHistory.undo(unassigned), commandDoc, 'assignPartBoneをUndoできる');

const interpolationKeys = [
  { frame: 2, rotation: [0, 0, 0] },
  { frame: 6, rotation: [0, 0, 80] },
];
assert.deepEqual(interpolateRotation(interpolationKeys, 0), [0, 0, 0], '最初のキーより前は最初の姿勢');
assert.deepEqual(interpolateRotation(interpolationKeys, 8), [0, 0, 80], '最後のキー以降は最後の姿勢');
assert.ok(Math.abs(interpolateRotation(interpolationKeys, 4)[2] - 40) < 1e-8, '中間フレームをslerpする');
const shortest = interpolateRotation([
  { frame: 0, rotation: [0, 0, 350] },
  { frame: 10, rotation: [0, 0, 10] },
], 5);
assert.ok(shortest[2] < 1e-8 || 360 - shortest[2] < 1e-8, '350度から10度は20度の短い向きで補間する');
const posed = applyAnimationFrame(doc, doc.animations[0].id, 0);
assert.deepEqual(posed.bones.find(bone => bone.id === 'b4').rotation, [25, 0, 0]);
assert.deepEqual(posed.bones.find(bone => bone.id === 'b1').rotation, [0, 0, 0], 'トラックがないボーンはバインドポーズ');
assert.deepEqual(doc.bones.find(bone => bone.id === 'b4').rotation, [0, 0, 0], 'フレーム適用は入力docを書き換えない');

const animationBase = createSampleDoc();
const animationHistory = new CommandHistory();
const keyed = animationHistory.execute(animationBase, { type: 'setKeyframe', animationId: 'a1', boneId: 'b3', frame: 4, rotation: [0, 15, 30] });
assert.deepEqual(keyed.animations[0].tracks.find(track => track.boneId === 'b3').keys, [{ frame: 4, rotation: [0, 15, 30] }]);
assert.deepEqual(animationHistory.undo(keyed), animationBase, 'setKeyframeをUndoできる');
const removedKey = new CommandHistory();
const withoutKey = removedKey.execute(keyed, { type: 'removeKeyframe', animationId: 'a1', boneId: 'b3', frame: 4 });
assert.equal(withoutKey.animations[0].tracks.some(track => track.boneId === 'b3'), false);
assert.deepEqual(removedKey.undo(withoutKey), keyed, 'removeKeyframeをUndoできる');
const settingsHistory = new CommandHistory();
const settingsChanged = settingsHistory.execute(keyed, { type: 'setClipSettings', animationId: 'a1', fps: 8, length: 4 });
assert.deepEqual([settingsChanged.animations[0].fps, settingsChanged.animations[0].length], [8, 4]);
assert.ok(settingsChanged.animations[0].tracks.every(track => track.keys.every(key => key.frame < 4)), '長さ短縮時は範囲外キーを除く');
assert.deepEqual(settingsHistory.undo(settingsChanged), keyed, 'setClipSettingsをUndoできる');

const invalidFrame = structuredClone(animationBase); invalidFrame.animations[0].tracks[0].keys[0].frame = -1;
assert.throws(() => validateDoc(invalidFrame), /キーフレーム/);
const duplicateFrame = structuredClone(animationBase); duplicateFrame.animations[0].tracks[0].keys.push(structuredClone(duplicateFrame.animations[0].tracks[0].keys[0]));
assert.throws(() => validateDoc(duplicateFrame), /キーフレーム/);
const missingBoneTrack = structuredClone(animationBase); missingBoneTrack.animations[0].tracks[0].boneId = 'missing';
assert.throws(() => validateDoc(missingBoneTrack), /ボーントラック/);
const invalidSettings = structuredClone(animationBase); invalidSettings.animations[0].fps = 0;
assert.throws(() => validateDoc(invalidSettings), /アニメーション/);

const batchBase = createChestSampleDoc();
const batchHistory = new CommandHistory();
const batchChanged = batchHistory.executeBatch(batchBase, [
  { type: 'rename', partId: batchBase.parts[0].id, name: '箱_l' },
  { type: 'setColor', partId: batchBase.parts[0].id, color: '#e0a070' },
]);
assert.equal(batchHistory.past.length, 1, 'バッチ全体を履歴1件にする');
assert.deepEqual(batchHistory.undo(batchChanged), batchBase, 'バッチ全体を1回でUndoできる');
const atomicHistory = new CommandHistory();
assert.throws(() => atomicHistory.executeBatch(batchBase, [
  { type: 'rename', partId: batchBase.parts[0].id, name: '変更途中' },
  { type: 'removePart', partId: 'missing' },
]));
assert.equal(atomicHistory.past.length, 0, '失敗したバッチは履歴へ追加しない');
const replacement = structuredClone(batchBase); replacement.name = '差し替え後';
assert.equal(new CommandHistory().replace(batchBase, replacement).name, '差し替え後');

const warningDoc = structuredClone(batchBase);
warningDoc.parts[0].name = 'arm_l';
warningDoc.parts[1].name = warningDoc.parts[2].name;
const report = validateModelReport(warningDoc);
assert.equal(report.valid, true);
assert.ok(report.warnings.some(warning => warning.code === 'unassigned_parts'));
assert.ok(report.warnings.some(warning => warning.code === 'unused_palette_colors'));
assert.ok(report.warnings.some(warning => warning.code === 'duplicate_parts_names'));
assert.ok(report.warnings.some(warning => warning.code === 'unpaired_parts_names'));
const invalidReportDoc = structuredClone(warningDoc); invalidReportDoc.grid = 0;
assert.equal(validateModelReport(invalidReportDoc).valid, false);

console.log('model texture tests: OK');
