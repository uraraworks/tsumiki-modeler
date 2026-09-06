// 面を外側から見たときの左上を各アトラス領域の左上へ合わせる。
export function atlasPixelForVertex(part, layout, position, normal, originalUv, texelsPerUnit) {
  const [x, y, z] = position, [nx, ny, nz] = normal;
  if (part.type === 'box') {
    const [w, h, d] = part.size;
    if (nx > .5) return ['right', (d / 2 - z) * texelsPerUnit, (h / 2 - y) * texelsPerUnit];
    if (nx < -.5) return ['left', (z + d / 2) * texelsPerUnit, (h / 2 - y) * texelsPerUnit];
    if (ny > .5) return ['up', (x + w / 2) * texelsPerUnit, (z + d / 2) * texelsPerUnit];
    if (ny < -.5) return ['down', (x + w / 2) * texelsPerUnit, (d / 2 - z) * texelsPerUnit];
    if (nz > .5) return ['front', (x + w / 2) * texelsPerUnit, (h / 2 - y) * texelsPerUnit];
    return ['back', (w / 2 - x) * texelsPerUnit, (h / 2 - y) * texelsPerUnit];
  }
  if (Math.abs(ny) < .5) {
    const region = layout.faces.side;
    return ['side', originalUv[0] * region[2], (1 - originalUv[1]) * region[3]];
  }
  const face = ny > 0 ? 'up' : 'down';
  const region = layout.faces[face];
  return [face, (x / part.radius + 1) * region[2] / 2, ((ny > 0 ? z : -z) / part.radius + 1) * region[3] / 2];
}
