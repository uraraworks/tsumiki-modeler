import { meshBounds } from './model.js';
// 面を外側から見たときの左上を各アトラス領域の左上へ合わせる。
export function atlasPixelForVertex(part, layout, position, normal, originalUv, texelsPerUnit) {
  const [x, y, z] = position, [nx, ny, nz] = normal;
  const mapped = (face, map) => {
    const region = layout?.faces?.[face];
    if (!region || region.length < 4 || !region.every(Number.isFinite)) return null;
    const [localX, localY] = map(region);
    return [face, localX, localY];
  };
  if (part.type === 'box') {
    const [w, h, d] = part.size;
    if (nx > .5) return mapped('right', () => [(d / 2 - z) * texelsPerUnit, (h / 2 - y) * texelsPerUnit]);
    if (nx < -.5) return mapped('left', () => [(z + d / 2) * texelsPerUnit, (h / 2 - y) * texelsPerUnit]);
    if (ny > .5) return mapped('up', () => [(x + w / 2) * texelsPerUnit, (z + d / 2) * texelsPerUnit]);
    if (ny < -.5) return mapped('down', () => [(x + w / 2) * texelsPerUnit, (d / 2 - z) * texelsPerUnit]);
    if (nz > .5) return mapped('front', () => [(x + w / 2) * texelsPerUnit, (h / 2 - y) * texelsPerUnit]);
    return mapped('back', () => [(w / 2 - x) * texelsPerUnit, (h / 2 - y) * texelsPerUnit]);
  }
  if (part.type === 'mesh') {
    // 各面をその法線に最も近い軸平面（XY/YZ/ZX）へ投影する。箱と同じ式を使うが、
    // バウンディングボックスの中心・寸法から算出するので、箱から変換した直後は箱と同じ結果になる。
    const { min, max } = meshBounds(part.vertices);
    const [w, h, d] = [0, 1, 2].map(axis => max[axis] - min[axis]);
    const [cx, cy, cz] = [0, 1, 2].map(axis => (max[axis] + min[axis]) / 2);
    const [lx, ly, lz] = [x - cx, y - cy, z - cz];
    const absNormal = [Math.abs(nx), Math.abs(ny), Math.abs(nz)];
    const axis = absNormal.indexOf(Math.max(...absNormal));
    if (axis === 0) {
      return nx >= 0
        ? mapped('right', () => [(d / 2 - lz) * texelsPerUnit, (h / 2 - ly) * texelsPerUnit])
        : mapped('left', () => [(lz + d / 2) * texelsPerUnit, (h / 2 - ly) * texelsPerUnit]);
    }
    if (axis === 1) {
      return ny >= 0
        ? mapped('up', () => [(lx + w / 2) * texelsPerUnit, (lz + d / 2) * texelsPerUnit])
        : mapped('down', () => [(lx + w / 2) * texelsPerUnit, (d / 2 - lz) * texelsPerUnit]);
    }
    return nz >= 0
      ? mapped('front', () => [(lx + w / 2) * texelsPerUnit, (h / 2 - ly) * texelsPerUnit])
      : mapped('back', () => [(w / 2 - lx) * texelsPerUnit, (h / 2 - ly) * texelsPerUnit]);
  }
  if (part.type === 'sphere' || part.type === 'capsule') {
    return mapped('surface', region => [originalUv[0] * region[2], (1 - originalUv[1]) * region[3]]);
  }
  if (Math.abs(ny) < .999) {
    return mapped('side', region => [originalUv[0] * region[2], (1 - originalUv[1]) * region[3]]);
  }
  const face = ny > 0 ? 'up' : 'down';
  const radius = face === 'up' ? (part.radiusTop ?? part.radius) : (part.radiusBottom ?? part.radius);
  return mapped(face, region => [
    radius ? (x / radius + 1) * region[2] / 2 : region[2] / 2,
    radius ? ((ny > 0 ? z : -z) / radius + 1) * region[3] / 2 : region[3] / 2,
  ]);
}
