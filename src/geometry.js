// 形状ごとの寸法参照を一箇所に集め、形状追加時の検査漏れを防ぐ。
export function calculatePartBounds(part) {
  let half;
  if (part.type === 'box') half = part.size.map(value => value / 2);
  else if (part.type === 'sphere') half = [part.radius, part.radius, part.radius];
  else if (part.type === 'capsule') half = [part.radius, part.height / 2 + part.radius, part.radius];
  else if (part.type === 'cylinder') {
    const radius = Math.max(part.radiusTop ?? part.radius, part.radiusBottom ?? part.radius);
    half = [radius, part.height / 2, radius];
  } else throw new Error(`未対応の形状です: ${part.type}`);
  return { min: half.map(value => -value), max: half };
}

export function resizeDimensions(part) {
  if (part.type === 'box') return { size: [...part.size] };
  if (part.type === 'sphere') return { radius: part.radius };
  if (part.type === 'capsule') return { radius: part.radius, height: part.height };
  if (part.type === 'cylinder') return {
    radius: part.radius,
    radiusTop: part.radiusTop ?? part.radius,
    radiusBottom: part.radiusBottom ?? part.radius,
    height: part.height,
  };
  throw new Error(`未対応の形状です: ${part.type}`);
}

export function resizeHandleLayout(part, dimensions = resizeDimensions(part)) {
  const specs = part.type === 'cylinder' && (part.radiusTop !== undefined || part.radiusBottom !== undefined)
    ? [
      { axis: 1, sign: -1 }, { axis: 1, sign: 1 },
      ...[0, 2].flatMap(axis => [-1, 1].flatMap(sign => [{ axis, sign, radiusEnd: 'top' }, { axis, sign, radiusEnd: 'bottom' }])),
    ]
    : [0, 1, 2].flatMap(axis => [-1, 1].map(sign => ({ axis, sign })));
  return specs.map(spec => {
    const { axis, sign, radiusEnd } = spec;
    let extent;
    if (part.type === 'box') extent = dimensions.size[axis] / 2;
    else if (part.type === 'sphere') extent = dimensions.radius;
    else if (axis === 1) extent = part.type === 'capsule' ? dimensions.height / 2 + dimensions.radius : dimensions.height / 2;
    else extent = radiusEnd ? dimensions[radiusEnd === 'top' ? 'radiusTop' : 'radiusBottom'] : dimensions.radius;
    const position = [0, 0, 0];
    position[axis] = sign * extent;
    if (radiusEnd) position[1] = radiusEnd === 'top' ? dimensions.height / 2 : -dimensions.height / 2;
    return { ...spec, position };
  });
}

// ブラウザのリサイズプレビューとNodeテストで同じ形状別計算を使う。
export function resizePreviewScale(part, dimensions = resizeDimensions(part)) {
  if (part.type === 'box') return dimensions.size.map((value, axis) => value / part.size[axis]);
  if (part.type === 'sphere') return Array(3).fill(dimensions.radius / part.radius);
  if (part.type === 'capsule') return [
    dimensions.radius / part.radius,
    (dimensions.height + dimensions.radius * 2) / (part.height + part.radius * 2),
    dimensions.radius / part.radius,
  ];
  if (part.type === 'cylinder') return [dimensions.radius / part.radius, dimensions.height / part.height, dimensions.radius / part.radius];
  return [1, 1, 1];
}

// Three.jsを引数で受け取り、ブラウザとNodeテストの双方から形状生成を検査できるようにする。
export function createPartGeometry(part, THREE) {
  let geometry;
  switch (part.type) {
    case 'box': geometry = new THREE.BoxGeometry(...part.size); break;
    case 'cylinder': geometry = new THREE.CylinderGeometry(part.radiusTop ?? part.radius, part.radiusBottom ?? part.radius, part.height, part.segments, 1); break;
    case 'sphere': geometry = new THREE.SphereGeometry(part.radius, part.segments, Math.max(4, Math.ceil(part.segments / 2))); break;
    case 'capsule': geometry = new THREE.CapsuleGeometry(part.radius, part.height, part.segments, part.segments); break;
    default: throw new Error(`未対応の形状です: ${part.type}`);
  }
  // render_preview の Box3.expandByObject もこの形状別計算を使う。
  if (THREE.Box3 && THREE.Vector3) {
    const { min, max } = calculatePartBounds(part);
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));
  }
  return geometry;
}
