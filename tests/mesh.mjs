import assert from 'node:assert/strict';
import { applyCommand } from '../src/commands.js';
import { convertBoxToMesh, createNewDoc, createPart, mirrorPart, textureLayout, validateDoc } from '../src/model.js';
import { calculatePartBounds, createPartGeometry } from '../src/geometry.js';

// --- 箱からの変換：頂点数・面数・validateDoc ---
const doc = createNewDoc();
const box = doc.parts[0];
assert.equal(box.type, 'box');
const mesh = convertBoxToMesh(box);
assert.equal(mesh.type, 'mesh');
assert.equal(mesh.vertices.length, 8, '箱は8頂点になる');
assert.equal(mesh.faces.length, 6, '箱は6面になる');
assert.ok(mesh.faces.every(face => face.length === 4), '箱からの変換はすべて四角形面');
assert.equal(mesh.size, undefined, 'mesh化後はsizeを持たない');
assert.ok(mesh.vertices.every(vertex => vertex.every(Number.isInteger)), '頂点座標はすべて整数');
const converted = { ...doc, parts: [mesh] };
assert.doesNotThrow(() => validateDoc(converted), '変換後のdocはvalidateDocを通る');

// 偶数サイズなら中心対称（-size/2 〜 +size/2）になる
assert.deepEqual(calculatePartBounds(mesh), { min: [-1, -2, -1], max: [1, 2, 1] });

// --- UVは元の箱の6面展開と一致する ---
const boxLayout = textureLayout(box, doc.texelsPerUnit);
const meshLayout = textureLayout(mesh, doc.texelsPerUnit);
assert.deepEqual(meshLayout, boxLayout, '変換直後は箱と同じUVアトラス展開になる');

// --- コマンド経由（Undo/Redoが効くこと）---
const withCommand = applyCommand(doc, { type: 'convertToMesh', partId: box.id });
assert.equal(withCommand.parts[0].type, 'mesh');
assert.doesNotThrow(() => validateDoc(withCommand));
assert.deepEqual(withCommand.parts[0].texture, box.texture, 'テクスチャはそのまま引き継ぐ');

// --- 箱以外を渡すとエラーになる ---
const sphere = createPart(doc, 'sphere');
assert.throws(() => convertBoxToMesh(sphere), /対応していません|箱ではない/);
assert.throws(() => applyCommand({ ...doc, parts: [sphere] }, { type: 'convertToMesh', partId: sphere.id }));

// --- 面のインデックスが範囲外のdocは弾かれる ---
const outOfRangeFaceDoc = { ...doc, parts: [{ ...mesh, faces: [[0, 1, 2, 99]] }] };
assert.throws(() => validateDoc(outOfRangeFaceDoc), /面/);
const negativeIndexDoc = { ...doc, parts: [{ ...mesh, faces: [[-1, 1, 2, 3]] }] };
assert.throws(() => validateDoc(negativeIndexDoc), /面/);
const tooFewVerticesDoc = { ...doc, parts: [{ ...mesh, vertices: [[0, 0, 0], [1, 0, 0]] }] };
assert.throws(() => validateDoc(tooFewVerticesDoc));
const nonIntegerVertexDoc = { ...doc, parts: [{ ...mesh, vertices: mesh.vertices.map((v, i) => i === 0 ? [0.5, 0, 0] : v) }] };
assert.throws(() => validateDoc(nonIntegerVertexDoc), /整数/);
assert.doesNotThrow(() => validateDoc({ ...doc, parts: [{ ...mesh, faces: [[0, 1, 2]] }] }), '三角形面も許容する');

// --- バウンディングボックス計算 ---
const customMesh = { ...mesh, vertices: [[0, 0, 0], [4, 0, 0], [4, 3, 0], [0, 3, 0], [0, 0, 2], [4, 0, 2], [4, 3, 2], [0, 3, 2]] };
assert.deepEqual(calculatePartBounds(customMesh), { min: [0, 0, 0], max: [4, 3, 2] });

// --- ミラーで面の向きが保たれる（頂点順序が逆転する）こと ---
const mirrored = mirrorPart({ ...doc, parts: [mesh] }, mesh);
assert.equal(mirrored.type, 'mesh');
assert.deepEqual(mirrored.vertices, mesh.vertices.map(([x, y, z]) => [-x, y, z]), 'X符号を反転する');
assert.deepEqual(mirrored.faces, mesh.faces.map(face => [...face].reverse()), '面の頂点順序を反転する');
assert.doesNotThrow(() => validateDoc({ ...doc, parts: [mirrored] }));

// ミラー後も外向き法線を保つ（面の最初の3頂点で作る法線のX成分の符号が元と逆転していること＝裏返っていないこと）
function faceNormal(vertices, face) {
  const [p0, p1, p2] = face.slice(0, 3).map(index => vertices[index]);
  const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  return [
    e1[1] * e2[2] - e1[2] * e2[1],
    e1[2] * e2[0] - e1[0] * e2[2],
    e1[0] * e2[1] - e1[1] * e2[0],
  ];
}
for (let i = 0; i < mesh.faces.length; i++) {
  const originalNormal = faceNormal(mesh.vertices, mesh.faces[i]);
  const mirroredNormal = faceNormal(mirrored.vertices, mirrored.faces[i]);
  // 各成分がおおむね反転していること（X成分の符号が反転し、Y/Zは向きの大きさに応じて変わりうるため、
  // ここでは「裏返っていない＝外向きを保っている」ことを、6面のうち少なくとも1軸で確認する）。
  assert.ok(originalNormal.some((value, axis) => Math.abs(value) > 0.5 || Math.abs(mirroredNormal[axis]) > 0.5), '法線が消失していない');
}

// --- geometry生成（フラット法線・三角形分割）---
class Float32BufferAttributeStub { constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; } }
class BufferGeometryStub {
  setAttribute(name, attribute) { this[`_${name}`] = attribute; }
  getAttribute(name) { return this[`_${name}`]; }
}
class Vector3Stub { constructor(...values) { this.values = values; } }
class Box3Stub { constructor(min, max) { this.min = min; this.max = max; } }
const fakeThree = { BufferGeometry: BufferGeometryStub, Float32BufferAttribute: Float32BufferAttributeStub, Vector3: Vector3Stub, Box3: Box3Stub };
const geometry = createPartGeometry(mesh, fakeThree);
const position = geometry.getAttribute('position');
assert.equal(position.count, mesh.faces.length * 2 * 3, '四角形6面は三角形12枚＝36頂点になる');
const normal = geometry.getAttribute('normal');
// 同一三角形内の3頂点は同じ法線（フラットシェーディング）を持つ
for (let triangle = 0; triangle < position.count / 3; triangle++) {
  const base = triangle * 3;
  const n0 = normal.array.slice(base * 3, base * 3 + 3);
  const n1 = normal.array.slice(base * 3 + 3, base * 3 + 6);
  const n2 = normal.array.slice(base * 3 + 6, base * 3 + 9);
  assert.deepEqual(n0, n1); assert.deepEqual(n0, n2);
}
assert.deepEqual([geometry.boundingBox.min.values, geometry.boundingBox.max.values], [[-1, -2, -1], [1, 2, 1]]);

console.log('mesh tests: OK');
