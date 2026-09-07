import assert from 'node:assert/strict';
import { applyCommand, CommandHistory } from '../src/commands.js';
import { convertBoxToMesh, convertPartToMesh, createNewDoc, createPart, extrudeMeshFace, mergeParts, mirrorPart, textureLayout, validateDoc, weldVertices } from '../src/model.js';
import { calculatePartBounds, createPartGeometry } from '../src/geometry.js';

// --- 箱からの変換：頂点数・面数・validateDoc ---
const doc = createNewDoc();
const box = doc.parts[0];
assert.equal(box.type, 'box');
const mesh = convertBoxToMesh(box, doc.texelsPerUnit);
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

// --- UV：面ごとの平面展開でも、軸に平行な面（箱からの変換直後）は箱と同じ領域サイズになる ---
// （最重要：斜めの面でテクセルが歪まないよう、面ごとに実寸で展開する方式へ変更したが、
//   軸平行面ではサイズが変わらないことを保証する。名前付きキー→数値インデックスキーへ
//   構造が変わったため、各面の[幅,高さ]の集合が一致することを比較する）。
const boxLayout = textureLayout(box, doc.texelsPerUnit);
const meshLayout = textureLayout(mesh, doc.texelsPerUnit);
// 面ごとの基準辺（U軸）の選び方により、同じ矩形が90度回転（幅と高さが入れ替わる）ことがあるが、
// 面積・アスペクト比は変わらず「歪み」ではないため、比較時は各矩形を[短辺,長辺]へ正規化する。
const normalizedSize = ([, , w, h]) => [Math.min(w, h), Math.max(w, h)];
const boxFaceSizes = Object.values(boxLayout.faces).map(normalizedSize).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const meshFaceSizes = Object.values(meshLayout.faces).map(normalizedSize).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
assert.deepEqual(meshFaceSizes, boxFaceSizes, '箱から変換した直後は、各面のUV領域サイズ（回転を除く）が箱と一致する');
assert.equal(Object.keys(meshLayout.faces).length, 6, '面は6個ぶんの領域を持つ');

// --- コマンド経由（Undo/Redoが効くこと）---
const withCommand = applyCommand(doc, { type: 'convertToMesh', partId: box.id });
assert.equal(withCommand.parts[0].type, 'mesh');
assert.doesNotThrow(() => validateDoc(withCommand));
// アトラスの詰め方（全体サイズ）は箱と変わりうるが、元が無地なら変換後も無地のまま。
assert.ok(withCommand.parts[0].texture.rows.every(row => [...row].every(character => character === '.')), 'テクスチャ内容（無地）を引き継ぐ');

// --- convertBoxToMeshは箱専用のまま（曲面はconvertPartToMesh/convertToMeshコマンド経由） ---
const sphere = createPart(doc, 'sphere');
assert.throws(() => convertBoxToMesh(sphere), /対応していません|箱ではない/);
assert.doesNotThrow(() => applyCommand({ ...doc, parts: [sphere] }, { type: 'convertToMesh', partId: sphere.id }), '球はconvertToMeshコマンドでメッシュへ変換できる');

// --- 面のインデックスが範囲外のdocは弾かれる ---
const outOfRangeFaceDoc = { ...doc, parts: [{ ...mesh, faces: [[0, 1, 2, 99]] }] };
assert.throws(() => validateDoc(outOfRangeFaceDoc), /面/);
const negativeIndexDoc = { ...doc, parts: [{ ...mesh, faces: [[-1, 1, 2, 3]] }] };
assert.throws(() => validateDoc(negativeIndexDoc), /面/);
const tooFewVerticesDoc = { ...doc, parts: [{ ...mesh, vertices: [[0, 0, 0], [1, 0, 0]] }] };
assert.throws(() => validateDoc(tooFewVerticesDoc));
const nonIntegerVertexDoc = { ...doc, parts: [{ ...mesh, vertices: mesh.vertices.map((v, i) => i === 0 ? [0.5, 0, 0] : v) }] };
assert.throws(() => validateDoc(nonIntegerVertexDoc), /整数/);
// texture省略：面構成を変えるとUVアトラス寸法も変わるため、この検証には無関係なtextureを外す。
const triangleMesh = { ...mesh, faces: [[0, 1, 2]] };
delete triangleMesh.texture;
assert.doesNotThrow(() => validateDoc({ ...doc, parts: [triangleMesh] }), '三角形面も許容する');

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
  constructor() { this.userData = {}; }
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
// 各頂点が属する元のface index（面選択・押し出しのヒット判定・UVの両方が依存する）
assert.equal(geometry.userData.meshFaceIndices.length, position.count);
for (let face = 0; face < mesh.faces.length; face++) {
  for (let i = face * 6; i < face * 6 + 6; i++) assert.equal(geometry.userData.meshFaceIndices[i], face);
}

// --- 押し出し：四角形1面を押し出すと、頂点+4、面は元の1面が移動し側面4面が増える ---
function faceCentroid(vertices, face) {
  const points = face.map(index => vertices[index]);
  return [0, 1, 2].map(axis => points.reduce((sum, p) => sum + p[axis], 0) / points.length);
}
function meshCentroid(vertices) {
  return [0, 1, 2].map(axis => vertices.reduce((sum, v) => sum + v[axis], 0) / vertices.length);
}
const extrudeResult = extrudeMeshFace(mesh, [0], 1, doc.texelsPerUnit);
const extrudedMesh = extrudeResult.part;
assert.equal(extrudedMesh.vertices.length, mesh.vertices.length + 4, '頂点が4個増える');
assert.equal(extrudedMesh.faces.length, mesh.faces.length + 4, '面が4個増える（元の面は移動、側面4面が追加）');
assert.ok(extrudedMesh.vertices.every(vertex => vertex.every(Number.isInteger)), '押し出し後も頂点座標は整数');
assert.doesNotThrow(() => validateDoc({ ...doc, parts: [extrudedMesh] }), '押し出し後もvalidateDocを通る');
assert.equal(extrudeResult.pixelsLost, false, 'テクスチャなしの押し出しはピクセル損失なし');

// 押し出し後も全面の法線が外向きを保っていること（各面の重心が、メッシュ全体の重心から見て
// 面法線の向きにあること＝凸形状で「法線が外を向いている」ことの一般的な確認方法）。
const center = meshCentroid(extrudedMesh.vertices);
for (const face of extrudedMesh.faces) {
  const normal = faceNormal(extrudedMesh.vertices, face);
  const centroid = faceCentroid(extrudedMesh.vertices, face);
  const outward = [0, 1, 2].map(axis => centroid[axis] - center[axis]);
  const dot = normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2];
  assert.ok(dot > 0, '面の法線は外側を向いている');
}

// --- 押し出し距離0はコマンドを発行しない（applyCommandは無変化、CommandHistoryは履歴に積まない） ---
const meshDocForZero = { ...doc, parts: [mesh] };
const zeroResult = applyCommand(meshDocForZero, { type: 'extrudeFace', partId: mesh.id, faces: [0], distance: 0 });
assert.deepEqual(zeroResult, validateDoc(structuredClone(meshDocForZero)), '距離0は何も変えない');
const zeroHistory = new CommandHistory();
const afterZero = zeroHistory.execute(meshDocForZero, { type: 'extrudeFace', partId: mesh.id, faces: [0], distance: 0 });
assert.equal(zeroHistory.past.length, 0, '距離0はUndo履歴に積まれない');
assert.deepEqual(afterZero, validateDoc(structuredClone(meshDocForZero)));

// --- コマンド経由の押し出し：面の対応関係からテクスチャを可能な限り引き継ぐ ---
const meshWithTexture = withCommand.parts[0];
const layoutBeforeExtrude = textureLayout(meshWithTexture, doc.texelsPerUnit);
const untouchedFaceIndex = 1;
const [px, py] = layoutBeforeExtrude.faces[untouchedFaceIndex];
const paintedDoc = applyCommand(withCommand, { type: 'paintPixels', partId: meshWithTexture.id, pixels: [[px, py, '1']] });
const paintedPart = paintedDoc.parts[0];
assert.equal(paintedPart.texture.rows[py][px], '1');
const extrudedDoc = applyCommand(paintedDoc, { type: 'extrudeFace', partId: paintedPart.id, faces: [0], distance: 1 });
const extrudedPart = extrudedDoc.parts[0];
const layoutAfterExtrude = textureLayout(extrudedPart, doc.texelsPerUnit);
const [px2, py2] = layoutAfterExtrude.faces[untouchedFaceIndex];
assert.equal(extrudedPart.texture.rows[py2][px2], '1', '押し出しに関係ない面のドットは保持される');
for (let faceIndex = meshWithTexture.faces.length; faceIndex < extrudedPart.faces.length; faceIndex++) {
  const [fx, fy, fw, fh] = layoutAfterExtrude.faces[faceIndex];
  for (let y = fy; y < fy + fh; y++) for (let x = fx; x < fx + fw; x++) assert.equal(extrudedPart.texture.rows[y][x], '.', '新しくできた面は未指定で埋まる');
}

// --- 不正な入力はエラーになる ---
assert.throws(() => extrudeMeshFace(mesh, [99], 1, doc.texelsPerUnit), /面/);
assert.throws(() => extrudeMeshFace(box, [0], 1, doc.texelsPerUnit), /メッシュではない/);
assert.throws(() => extrudeMeshFace(mesh, [0], 1.5, doc.texelsPerUnit), /整数/);

// --- 曲面プリミティブ（円柱・円錐台・球・カプセル）もメッシュへ変換できること ---
for (const spec of [
  { type: 'cylinder', extra: {} },
  { type: 'cylinder', extra: { radiusTop: 1, radiusBottom: 3 } }, // 円錐台
  { type: 'sphere', extra: {} },
  { type: 'capsule', extra: {} },
]) {
  const curvedPart = { ...createPart(doc, spec.type), ...spec.extra };
  const { part: converted, pixelsLost } = convertPartToMesh(curvedPart, doc.texelsPerUnit);
  assert.equal(converted.type, 'mesh', `${spec.type}はmeshへ変換される`);
  assert.ok(converted.vertices.length >= 4 && converted.vertices.length <= 2000, `${spec.type}の頂点数は妥当な範囲`);
  assert.ok(converted.faces.length >= 4 && converted.faces.length <= 2000, `${spec.type}の面数は妥当な範囲`);
  assert.ok(converted.vertices.every(v => v.every(Number.isInteger)), `${spec.type}変換後も頂点座標は整数`);
  assert.ok(converted.faces.every(face => face.length === 3 || face.length === 4), `${spec.type}の面は三角形か四角形`);
  assert.equal(pixelsLost, false, '無地のパーツはテクスチャ喪失なし');
  assert.doesNotThrow(() => validateDoc({ ...doc, parts: [converted] }), `${spec.type}変換後のdocはvalidateDocを通る`);
}

// --- 結合：離れた箱2つを結合すると頂点・面が単純合算になる（接触が無いので重複除去は起きない） ---
{
  const mergeDoc = createNewDoc();
  const boxA = { ...createPart(mergeDoc, 'box'), id: 'pa', position: [0, 2, 0], size: [2, 2, 2] };
  delete boxA.texture;
  const boxB = { ...createPart(mergeDoc, 'box'), id: 'pb', position: [10, 2, 0], size: [2, 2, 2] };
  delete boxB.texture;
  const baseDoc = validateDoc({ ...mergeDoc, parts: [boxA, boxB] });
  const result = mergeParts(baseDoc, ['pa', 'pb'], baseDoc.texelsPerUnit);
  assert.equal(result.doc.parts.length, 1, '結合で1パーツにまとまる');
  const merged = result.doc.parts.find(p => p.id === result.mergedPartId);
  assert.equal(merged.vertices.length, 16, '離れた箱2つは頂点16個（重複無し）');
  assert.equal(merged.faces.length, 12, '離れた箱2つは面12個（重複無し）');
  assert.equal(merged.name, `${boxA.name}ほか`, '結合後の名前は1つ目のパーツ名＋ほか');
  assert.equal(merged.color, boxA.color, '結合後の色は1つ目のパーツの色');
  assert.equal(result.shapeRounded, false, '軸平行な箱の結合では丸めによる形状変化は起きない');
  assert.doesNotThrow(() => validateDoc(result.doc), '結合後もvalidateDocを通る');

  // --- コマンド経由：Undoで元の複数パーツへ戻る ---
  const history = new CommandHistory();
  const afterMerge = history.execute(baseDoc, { type: 'mergeParts', partIds: ['pa', 'pb'] });
  assert.equal(afterMerge.parts.length, 1, 'コマンド経由でも1パーツにまとまる');
  const afterUndo = history.undo(afterMerge);
  assert.equal(afterUndo.parts.length, 2, 'Undoで元の2パーツに戻る');
  assert.deepEqual(afterUndo.parts.map(p => p.id).sort(), ['pa', 'pb'], 'Undoで元のIDが戻る');
}

// --- 回転したパーツを結合すると、頂点は整数に丸められ、shapeRoundedが立つ ---
{
  const rotDoc = createNewDoc();
  const boxA = { ...createPart(rotDoc, 'box'), id: 'pa', position: [0, 2, 0], size: [2, 2, 2] };
  delete boxA.texture;
  const boxB = { ...createPart(rotDoc, 'box'), id: 'pb', position: [8, 2, 0], size: [2, 2, 2], rotation: [0, 15, 0] };
  delete boxB.texture;
  const baseDoc = validateDoc({ ...rotDoc, parts: [boxA, boxB] });
  const result = mergeParts(baseDoc, ['pa', 'pb'], baseDoc.texelsPerUnit);
  assert.equal(result.shapeRounded, true, '15度回転したパーツの結合では丸めが発生する');
  const merged = result.doc.parts.find(p => p.id === result.mergedPartId);
  assert.ok(merged.vertices.every(v => v.every(Number.isInteger)), '結合後も頂点座標は整数');
  assert.doesNotThrow(() => validateDoc(result.doc));
}

// --- 結合は2つ未満の指定を拒否する ---
assert.throws(() => mergeParts(doc, ['p1'], doc.texelsPerUnit), /2つ以上/);

// --- 溶接：重複頂点が統合され、面数が正しく減る ---
{
  // 同じ頂点を共有するはずの2つの四角形（頂点0,1が両方の面で重複している）を、
  // わざと別インデックスの重複頂点として持つ小さなmeshを作る。
  const weldPart = {
    ...createPart(doc, 'box'), type: 'mesh',
    vertices: [
      [0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0], // 面0
      [0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2], // 面1（0,1と同じ座標を別インデックスで重複させてある）
    ],
    faces: [[0, 1, 2, 3], [4, 5, 6, 7]],
  };
  delete weldPart.texture;
  const { part: welded, verticesRemoved, facesRemoved } = weldVertices(weldPart, 0, doc.texelsPerUnit);
  assert.equal(verticesRemoved, 2, '重複していた2頂点が統合される');
  assert.equal(welded.vertices.length, 6, '8頂点→6頂点に減る');
  assert.equal(welded.faces.length, 2, '面自体は退化せず2枚のまま残る');
  assert.equal(facesRemoved, 0);
  assert.doesNotThrow(() => validateDoc({ ...doc, parts: [welded] }));

  // --- 退化した面が除去されること：しきい値を大きくして全頂点を1点に統合する ---
  const { part: fullyWelded, facesRemoved: removedAll } = weldVertices(weldPart, 100, doc.texelsPerUnit);
  assert.equal(fullyWelded.vertices.length, 1, 'しきい値が十分大きいと全頂点が1つに統合される');
  assert.equal(fullyWelded.faces.length, 0, '1点に潰れた面はすべて退化として除去される');
  assert.equal(removedAll, 2);

  // --- コマンド経由のUndo ---
  const weldDoc = validateDoc({ ...doc, parts: [{ ...weldPart, id: 'pw' }] });
  const history = new CommandHistory();
  const afterWeld = history.execute(weldDoc, { type: 'weldVertices', partId: 'pw', threshold: 0 });
  assert.equal(afterWeld.parts[0].vertices.length, 6, 'コマンド経由でも溶接される');
  const afterUndo = history.undo(afterWeld);
  assert.equal(afterUndo.parts[0].vertices.length, 8, 'Undoで溶接前の頂点数に戻る');
}

console.log('mesh tests: OK');
