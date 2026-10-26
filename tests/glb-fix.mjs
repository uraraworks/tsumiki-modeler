// GLB修正モードの編集ロジック（src/glb-fix/glb-edit.js）の検証。
import assert from 'node:assert/strict';
import {
  buildPositionGroups, expandToGroups, growSelection, verticesWithinRadius, moveVertices, flattenTarget,
  flattenVertices, recomputeNormals, EditHistory, paintCircle, stampCircle, sampleColor, brushRect, rgbToHex, hexToRgb,
} from '../src/glb-fix/glb-edit.js';

// 単位正方形（z=0）を2枚の三角形で。頂点2はUVの継ぎ目を想定して同じ位置に2つ（2と4）ある。
const positions = new Float32Array([
  0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0,
]);
const indexArray = new Uint32Array([0, 1, 2, 0, 4, 3]);
const groups = buildPositionGroups(positions);

// 同じ位置の頂点は1つのグループになる
assert.equal(groups.groups.length, 4);
assert.equal(groups.groupOf[2], groups.groupOf[4]);
assert.deepEqual(expandToGroups([2], groups), [2, 4]);
assert.deepEqual(expandToGroups([4, 0], groups), [0, 2, 4]);

// 半径選択
assert.deepEqual(verticesWithinRadius(positions, [1, 1, 0], 0.1), [2, 4]);
assert.deepEqual(verticesWithinRadius(positions, [0.5, 0.5, 0], 0.8).length, 5);

// 選択を広げる：頂点1から、同じ三角形の0・2と、2と同じ位置の4まで広がる
assert.deepEqual(growSelection([1], indexArray, groups), [0, 1, 2, 4]);

// 移動と平面に揃える
{
  const p = positions.slice();
  moveVertices(p, [2, 4], [0, 0, 0.5]);
  assert.equal(p[2 * 3 + 2], 0.5);
  assert.equal(p[4 * 3 + 2], 0.5);
  assert.equal(flattenTarget(p, [0, 2], 2, 'max'), 0.5);
  assert.equal(flattenTarget(p, [0, 2], 2, 'min'), 0);
  assert.equal(flattenTarget(p, [0, 2], 2, 'average'), 0.25);
  assert.equal(flattenTarget(p, [0, 2], 2, 'first', 2), 0.5);
  flattenVertices(p, [2, 4], 2, 0);
  assert.deepEqual([...p], [...positions]);
}

// 法線の再計算：平らな正方形は+Z、継ぎ目の頂点2と4は同じ法線になる
{
  const normals = new Float32Array(positions.length);
  const affected = recomputeNormals(positions, normals, indexArray, groups, [2]);
  assert.ok(affected.includes(2) && affected.includes(4));
  for (const index of [0, 1, 2, 3, 4]) assert.deepEqual([...normals.slice(index * 3, index * 3 + 3)], [0, 0, 1]);
}

// Undo/Redo
{
  const history = new EditHistory(2);
  let value = 0;
  const push = to => { const from = value; value = to; history.push({ label: String(to), undo: () => { value = from; }, redo: () => { value = to; } }); };
  push(1); push(2); push(3);
  assert.equal(history.undoStack.length, 2); // 上限を超えた古い記録は捨てる
  history.undo(); assert.equal(value, 2);
  history.redo(); assert.equal(value, 3);
  history.undo(); history.undo(); assert.equal(value, 1);
  assert.equal(history.canUndo, false);
  push(5); assert.equal(history.canRedo, false);
}

// ペイント
{
  const width = 8, height = 8;
  const data = new Uint8ClampedArray(width * height * 4).fill(0);
  assert.deepEqual(brushRect(-5, -5, 1, width, height), null);
  const rect = paintCircle(data, width, height, 4, 4, 2, [255, 0, 0], 1, 1);
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= width && rect.y + rect.h <= height);
  assert.deepEqual([...data.slice((4 * width + 4) * 4, (4 * width + 4) * 4 + 3)], [255, 0, 0]);
  assert.deepEqual([...data.slice(0, 3)], [0, 0, 0]); // 円の外は塗らない
  assert.deepEqual(sampleColor(data, width, height, 4, 4, 1), [255, 0, 0]);
  // 半分の濃さ
  const half = new Uint8ClampedArray(width * height * 4).fill(0);
  paintCircle(half, width, height, 4, 4, 2, [200, 100, 0], 0.5, 1);
  assert.deepEqual([...half.slice((4 * width + 4) * 4, (4 * width + 4) * 4 + 3)], [100, 50, 0]);
  // スタンプ：右に4ずれた位置の模様を写す
  const source = new Uint8ClampedArray(width * height * 4).fill(0);
  source.set([10, 20, 30], (1 * width + 6) * 4);
  const target = new Uint8ClampedArray(width * height * 4).fill(0);
  stampCircle(target, source, width, height, 2.5, 1.5, 1, 4, 0, 1, 1);
  assert.deepEqual([...target.slice((1 * width + 2) * 4, (1 * width + 2) * 4 + 3)], [10, 20, 30]);
}

assert.equal(rgbToHex([255, 16, 0]), '#ff1000');
assert.deepEqual(hexToRgb('#ff1000'), [255, 16, 0]);
console.log('glb-fix: ok');
