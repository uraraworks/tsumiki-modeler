// GLB修正モードの編集ロジック。DOMにもThree.jsにも依存せず、型付き配列だけを扱う
// （ブラウザとNodeのテストで同じコードを使うため）。
// ModelDocとは別系統：TripoAIなどが出力した実数座標・独自UV・画像テクスチャのメッシュをそのまま直す用途。

// UVの継ぎ目では、同じ位置の頂点がUV違いで複数に分かれている。1つだけ動かすと面が裂けるため、
// 位置が（ほぼ）同じ頂点を「グループ」にまとめ、選択や移動は常にグループ単位で行う。
export function buildPositionGroups(positions, epsilon = 1e-6) {
  const count = positions.length / 3;
  const groupOf = new Int32Array(count);
  const groups = [];
  const buckets = new Map();
  const quantize = value => Math.round(value / epsilon);
  for (let index = 0; index < count; index++) {
    const key = `${quantize(positions[index * 3])},${quantize(positions[index * 3 + 1])},${quantize(positions[index * 3 + 2])}`;
    let group = buckets.get(key);
    if (group === undefined) { group = groups.length; groups.push([]); buckets.set(key, group); }
    groups[group].push(index);
    groupOf[index] = group;
  }
  return { groupOf, groups };
}

// 頂点インデックスの集合を、同じ位置にある頂点も含むよう広げる（重複なし・昇順）。
export function expandToGroups(indices, groupInfo) {
  const result = new Set();
  for (const index of indices) for (const member of groupInfo.groups[groupInfo.groupOf[index]]) result.add(member);
  return [...result].sort((a, b) => a - b);
}

// 選択に面でつながっている頂点を1段ぶん足す（「選択を広げる」）。
export function growSelection(indices, indexArray, groupInfo) {
  const selectedGroups = new Set(indices.map(index => groupInfo.groupOf[index]));
  const result = new Set(indices);
  for (let t = 0; t < indexArray.length; t += 3) {
    const triangle = [indexArray[t], indexArray[t + 1], indexArray[t + 2]];
    if (triangle.some(vertex => selectedGroups.has(groupInfo.groupOf[vertex]))) for (const vertex of triangle) result.add(vertex);
  }
  return expandToGroups([...result], groupInfo);
}

export function getVertex(positions, index) {
  return [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]];
}

// 中心から半径以内にある頂点を返す（半径選択用）。
export function verticesWithinRadius(positions, center, radius) {
  const result = [];
  const radiusSq = radius * radius;
  for (let index = 0; index < positions.length / 3; index++) {
    const dx = positions[index * 3] - center[0], dy = positions[index * 3 + 1] - center[1], dz = positions[index * 3 + 2] - center[2];
    if (dx * dx + dy * dy + dz * dz <= radiusSq) result.push(index);
  }
  return result;
}

export function selectionCenter(positions, indices) {
  if (!indices.length) return null;
  const sum = [0, 0, 0];
  for (const index of indices) for (let axis = 0; axis < 3; axis++) sum[axis] += positions[index * 3 + axis];
  return sum.map(value => value / indices.length);
}

// 選択頂点の現在座標を控える。Undo記録（before/after）の材料にする。
export function snapshotVertices(positions, indices) {
  const values = new Float32Array(indices.length * 3);
  indices.forEach((index, i) => { for (let axis = 0; axis < 3; axis++) values[i * 3 + axis] = positions[index * 3 + axis]; });
  return values;
}

export function restoreVertices(positions, indices, values) {
  indices.forEach((index, i) => { for (let axis = 0; axis < 3; axis++) positions[index * 3 + axis] = values[i * 3 + axis]; });
}

export function moveVertices(positions, indices, delta) {
  for (const index of indices) for (let axis = 0; axis < 3; axis++) positions[index * 3 + axis] += delta[axis];
}

// 「平面に揃える」の基準値を求める。mode: 'average' | 'min' | 'max' | 'first'（最初に選んだ頂点）。
export function flattenTarget(positions, indices, axis, mode, firstIndex = indices[0]) {
  if (!indices.length) return null;
  const values = indices.map(index => positions[index * 3 + axis]);
  if (mode === 'min') return Math.min(...values);
  if (mode === 'max') return Math.max(...values);
  if (mode === 'first') return positions[firstIndex * 3 + axis];
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// 選択頂点の指定軸の座標を1つの値に揃える。欠けた角や凹んだ壁を、壁・屋上の平面へ戻すための操作。
export function flattenVertices(positions, indices, axis, value) {
  for (const index of indices) positions[index * 3 + axis] = value;
}

// 動かした頂点に関わる面だけ法線を作り直す。位置グループ単位で面法線（面積で重み付け）を合計するため、
// UVの継ぎ目でも法線が割れない。触っていない部分の法線はTripoの元の値のまま残す。
export function recomputeNormals(positions, normals, indexArray, groupInfo, movedIndices) {
  const touchedGroups = new Set(movedIndices.map(index => groupInfo.groupOf[index]));
  const affectedGroups = new Set();
  const triangles = [];
  for (let t = 0; t < indexArray.length; t += 3) {
    const a = indexArray[t], b = indexArray[t + 1], c = indexArray[t + 2];
    if (touchedGroups.has(groupInfo.groupOf[a]) || touchedGroups.has(groupInfo.groupOf[b]) || touchedGroups.has(groupInfo.groupOf[c])) {
      for (const vertex of [a, b, c]) affectedGroups.add(groupInfo.groupOf[vertex]);
    }
  }
  // 影響を受けるグループの法線は、そのグループに接する全ての面から合計し直す必要がある。
  for (let t = 0; t < indexArray.length; t += 3) {
    const a = indexArray[t], b = indexArray[t + 1], c = indexArray[t + 2];
    if (affectedGroups.has(groupInfo.groupOf[a]) || affectedGroups.has(groupInfo.groupOf[b]) || affectedGroups.has(groupInfo.groupOf[c])) triangles.push(a, b, c);
  }
  const sums = new Map([...affectedGroups].map(group => [group, [0, 0, 0]]));
  for (let t = 0; t < triangles.length; t += 3) {
    const [p0, p1, p2] = [triangles[t], triangles[t + 1], triangles[t + 2]].map(index => getVertex(positions, index));
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (let k = 0; k < 3; k++) {
      const sum = sums.get(groupInfo.groupOf[triangles[t + k]]);
      if (sum) for (let axis = 0; axis < 3; axis++) sum[axis] += n[axis];
    }
  }
  for (const [group, sum] of sums) {
    const length = Math.hypot(...sum);
    if (length < 1e-12) continue;
    for (const index of groupInfo.groups[group]) for (let axis = 0; axis < 3; axis++) normals[index * 3 + axis] = sum[axis] / length;
  }
  return [...affectedGroups].flatMap(group => groupInfo.groups[group]);
}

// Undo/Redo。各記録は { undo(), redo(), label } を持つ。上限を超えたら古いものから捨てる。
export class EditHistory {
  constructor(limit = 100) { this.limit = limit; this.undoStack = []; this.redoStack = []; }
  push(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }
  undo() { const entry = this.undoStack.pop(); if (!entry) return null; entry.undo(); this.redoStack.push(entry); return entry; }
  redo() { const entry = this.redoStack.pop(); if (!entry) return null; entry.redo(); this.undoStack.push(entry); return entry; }
  clear() { this.undoStack = []; this.redoStack = []; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
}

// テクスチャ上の筆の当たる範囲（画像の外にはみ出さない矩形）。ペイントのUndo記録の範囲にも使う。
export function brushRect(cx, cy, radius, width, height) {
  const x0 = Math.max(0, Math.floor(cx - radius)), y0 = Math.max(0, Math.floor(cy - radius));
  const x1 = Math.min(width, Math.ceil(cx + radius) + 1), y1 = Math.min(height, Math.ceil(cy + radius) + 1);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

// RGBA画素列（ImageData.dataと同じ並び）へ円形の筆を置く。hardness 0〜1（1でくっきり、0でふんわり）。
// opacityは1回の塗りの濃さ。ブラウザ側ではCanvasのImageDataに対して呼ぶ。
export function paintCircle(data, width, height, cx, cy, radius, rgb, opacity = 1, hardness = 0.7) {
  const rect = brushRect(cx, cy, radius, width, height);
  if (!rect) return null;
  const inner = radius * hardness;
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
    const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (distance > radius) continue;
    const falloff = distance <= inner ? 1 : 1 - (distance - inner) / Math.max(radius - inner, 1e-6);
    const alpha = opacity * falloff;
    const offset = (y * width + x) * 4;
    for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.round(data[offset + channel] * (1 - alpha) + rgb[channel] * alpha);
  }
  return rect;
}

// スタンプ（コピー塗り）：同じ画像の (dx, dy) だけずれた位置の色を写す。塗りむらのある壁を
// 周りの質感ごと埋めるときに使う。読み取りは塗る前の画素（source）から行い、塗った結果を拾い直さない。
export function stampCircle(data, source, width, height, cx, cy, radius, dx, dy, opacity = 1, hardness = 0.7) {
  const rect = brushRect(cx, cy, radius, width, height);
  if (!rect) return null;
  const inner = radius * hardness;
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) {
    const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (distance > radius) continue;
    const sx = Math.round(x + dx), sy = Math.round(y + dy);
    if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
    const falloff = distance <= inner ? 1 : 1 - (distance - inner) / Math.max(radius - inner, 1e-6);
    const alpha = opacity * falloff;
    const offset = (y * width + x) * 4, sourceOffset = (sy * width + sx) * 4;
    for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.round(data[offset + channel] * (1 - alpha) + source[sourceOffset + channel] * alpha);
  }
  return rect;
}

// スポイト：(x, y) を中心に size×size の平均色を返す（JPEGのノイズで1画素だけ拾うとブレるため）。
export function sampleColor(data, width, height, x, y, size = 3) {
  const half = Math.floor(size / 2);
  const sum = [0, 0, 0];
  let count = 0;
  for (let sy = Math.max(0, Math.round(y) - half); sy <= Math.min(height - 1, Math.round(y) + half); sy++) {
    for (let sx = Math.max(0, Math.round(x) - half); sx <= Math.min(width - 1, Math.round(x) + half); sx++) {
      const offset = (sy * width + sx) * 4;
      for (let channel = 0; channel < 3; channel++) sum[channel] += data[offset + channel];
      count++;
    }
  }
  return count ? sum.map(value => Math.round(value / count)) : null;
}

export const rgbToHex = rgb => `#${rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`;
export const hexToRgb = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
