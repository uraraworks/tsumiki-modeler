// 面を外側から見たときの左上を各アトラス領域の左上へ合わせる。
// faceIndexはmesh型のみ使用する（geometry.jsのuserData.meshFaceIndices経由で頂点ごとに渡される）。
export function atlasPixelForVertex(part, layout, position, normal, originalUv, texelsPerUnit, faceIndex) {
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
    // 面ごとの平面展開（meshFaceLayoutのprojections）を使う。軸平面への投影と違い、
    // 面自身の辺を基準にしたU/V軸で測るため、斜めの面でもテクセルが歪まない。
    if (faceIndex === undefined || faceIndex === null) return null;
    const projection = layout.projections?.[faceIndex];
    if (!projection) return null;
    const [ox, oy, oz] = projection.origin;
    const d = [x - ox, y - oy, z - oz];
    const localU = (d[0] * projection.u[0] + d[1] * projection.u[1] + d[2] * projection.u[2]) - projection.minU;
    const localV = (d[0] * projection.v[0] + d[1] * projection.v[1] + d[2] * projection.v[2]) - projection.minV;
    return mapped(String(faceIndex), () => [localU * texelsPerUnit, localV * texelsPerUnit]);
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
