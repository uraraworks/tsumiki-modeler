import assert from 'node:assert/strict';
import { applyCommand, CommandHistory } from '../src/commands.js';
import { convertBoxToMesh, createNewDoc, degenerateMeshFaceIndices, moveMeshVertices, textureLayout, validateDoc } from '../src/model.js';

const doc = createNewDoc();
const box = doc.parts[0];
const mesh = convertBoxToMesh(box, doc.texelsPerUnit);
const meshDoc = { ...doc, parts: [mesh] };

// --- moveMeshVertices の適用：頂点は整数のまま、指定した頂点だけ動く ---
const { part: moved, pixelsLost: moveLost } = moveMeshVertices(mesh, [2, 6], [0, 2, 0], doc.texelsPerUnit);
assert.ok(moved.vertices.every(vertex => vertex.every(Number.isInteger)), '移動後も頂点座標は整数');
assert.deepEqual(moved.vertices[2], [mesh.vertices[2][0], mesh.vertices[2][1] + 2, mesh.vertices[2][2]]);
assert.deepEqual(moved.vertices[6], [mesh.vertices[6][0], mesh.vertices[6][1] + 2, mesh.vertices[6][2]]);
for (let i = 0; i < mesh.vertices.length; i++) if (i !== 2 && i !== 6) assert.deepEqual(moved.vertices[i], mesh.vertices[i], `指定していない頂点${i}は動かない`);
assert.equal(moveLost, false, 'テクスチャなしの移動はピクセル損失なし');
assert.doesNotThrow(() => validateDoc({ ...doc, parts: [moved] }), '頂点移動後もvalidateDocを通る');

// --- コマンド経由の適用とUndo ---
const history = new CommandHistory();
const command = { type: 'moveVertices', partId: mesh.id, vertexIndices: [2, 6], delta: [0, 2, 0] };
const after = history.execute(meshDoc, command);
assert.equal(history.past.length, 1, '移動量が0でなければ履歴に積まれる');
assert.deepEqual(after.parts[0].vertices[2], moved.vertices[2]);
const undone = history.undo(after);
assert.deepEqual(undone, validateDoc(structuredClone(meshDoc)), 'Undoで元のdocに戻る');
const redone = history.redo(undone);
assert.deepEqual(redone, after, 'Redoで移動後のdocに戻る');

// --- 移動量0はコマンドを発行しない ---
const zeroHistory = new CommandHistory();
const zeroCommand = { type: 'moveVertices', partId: mesh.id, vertexIndices: [0], delta: [0, 0, 0] };
const zeroResult = applyCommand(meshDoc, zeroCommand);
assert.deepEqual(zeroResult, validateDoc(structuredClone(meshDoc)), '移動量0は何も変えない');
zeroHistory.execute(meshDoc, zeroCommand);
assert.equal(zeroHistory.past.length, 0, '移動量0はUndo履歴に積まれない');

// --- 面の実寸が変わったとき、UV領域サイズが新しい実寸に一致する ---
// 上面（+Y）は[3,7,6,2]。頂点2・6（x=+1側の辺）だけをX方向へ2グリッド伸ばすと、
// 辺3-7は動かないため矩形のまま、X方向の実寸だけ2→4（8px→16px）に変わる。
const upFaceIndex = mesh.faces.findIndex(face => face.includes(2) && face.includes(3) && face.includes(6) && face.includes(7));
assert.ok(upFaceIndex >= 0, '上面が見つかる');
const upLayoutBeforeMove = textureLayout(mesh, doc.texelsPerUnit).faces[upFaceIndex];
assert.deepEqual([upLayoutBeforeMove[2], upLayoutBeforeMove[3]].sort((a, b) => a - b), [8, 8], '移動前の上面は8x8px（前提の確認）');
const stretched = moveMeshVertices(mesh, [2, 6], [2, 0, 0], doc.texelsPerUnit).part;
const stretchedLayout = textureLayout(stretched, doc.texelsPerUnit);
const [, , stretchedWidth, stretchedHeight] = stretchedLayout.faces[upFaceIndex];
assert.deepEqual([stretchedWidth, stretchedHeight].sort((a, b) => a - b), [8, 16], '面のUV領域サイズが新しい実寸と一致する');

// --- 既存ピクセルの保持（左上基準の転写）とピクセル損失の検知 ---
const withCommand = applyCommand(doc, { type: 'convertToMesh', partId: box.id });
const meshWithTexture = withCommand.parts[0];
const layoutBefore = textureLayout(meshWithTexture, doc.texelsPerUnit);
// 移動しない面（頂点2・6を含まない面）の左上へドットを置く。
const untouchedFaceIndex = mesh.faces.findIndex(face => !face.includes(2) && !face.includes(6));
const [ux, uy] = layoutBefore.faces[untouchedFaceIndex];
const paintedDoc = applyCommand(withCommand, { type: 'paintPixels', partId: meshWithTexture.id, pixels: [[ux, uy, '1']] });
const paintedPart = paintedDoc.parts[0];
const movedDoc = applyCommand(paintedDoc, { type: 'moveVertices', partId: paintedPart.id, vertexIndices: [2, 6], delta: [2, 0, 0] });
const movedPart = movedDoc.parts[0];
const layoutAfter = textureLayout(movedPart, doc.texelsPerUnit);
const [ux2, uy2] = layoutAfter.faces[untouchedFaceIndex];
assert.equal(movedPart.texture.rows[uy2][ux2], '1', '移動に関係ない面のドットは保持される');

// 面を縮める（footprintを小さくする）と、はみ出したドットが失われ、pixelsLostがtrueになる。
const upLayoutBefore = layoutBefore.faces[upFaceIndex];
const paintedUpDoc = applyCommand(withCommand, {
  type: 'paintPixels', partId: meshWithTexture.id,
  pixels: [[upLayoutBefore[0] + upLayoutBefore[2] - 1, upLayoutBefore[1] + upLayoutBefore[3] - 1, '1']],
});
const { pixelsLost: shrinkLost } = moveMeshVertices(paintedUpDoc.parts[0], [2, 6], [-1, 0, 0], doc.texelsPerUnit);
assert.equal(shrinkLost, true, '面を縮めて右下のドットがはみ出すとピクセル損失になる');

// --- 退化した面（頂点が重なり、面全体が一直線に潰れる）の検出 ---
// 上面[3,7,6,2]の隣接2頂点（2↔3、6↔7）をそれぞれ重ねると、四角形全体が線分に潰れ面積0になる
// （対角線側だけを重ねた場合は三角形として残ってしまい退化しないため、隣接ペアを選ぶ）。
const collapsedVertices = mesh.vertices.map((vertex, index) => index === 2 ? [...mesh.vertices[3]] : index === 6 ? [...mesh.vertices[7]] : vertex);
const collapsed = { ...mesh, vertices: collapsedVertices };
delete collapsed.texture;
const degenerate = degenerateMeshFaceIndices(collapsed);
assert.ok(degenerate.includes(upFaceIndex), '頂点が重なって潰れた面は退化面として検出される');
assert.throws(() => validateDoc({ ...doc, parts: [collapsed] }), /面積0/, 'validateDocは退化した面を拒否する');
// vertex2→vertex3、vertex6→vertex7の移動量はどちらも同じ（両辺が平行）なので、1つのdeltaで両方潰せる。
const collapsingDelta = [0, 1, 2].map(axis => mesh.vertices[3][axis] - mesh.vertices[2][axis]);
assert.deepEqual(collapsingDelta, [0, 1, 2].map(axis => mesh.vertices[7][axis] - mesh.vertices[6][axis]), '前提：2つの辺は平行');
assert.throws(() => applyCommand(meshDoc, { type: 'moveVertices', partId: mesh.id, vertexIndices: [2, 6], delta: collapsingDelta }), /面積0/, '頂点を重ねて面を潰す移動コマンドは拒否される');

// --- 不正な入力はエラーになる ---
assert.throws(() => moveMeshVertices(mesh, [99], [1, 0, 0], doc.texelsPerUnit), /頂点/);
assert.throws(() => moveMeshVertices(mesh, [0], [0.5, 0, 0], doc.texelsPerUnit), /整数/);
assert.throws(() => moveMeshVertices(box, [0], [1, 0, 0], doc.texelsPerUnit), /メッシュではない/);

console.log('vertex-edit tests: OK');
