import { flatNormal, meshBounds } from './model.js';
// 形状ごとの寸法参照を一箇所に集め、形状追加時の検査漏れを防ぐ。
export function calculatePartBounds(part) {
  if (part.type === 'mesh') return meshBounds(part.vertices);
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
  // meshは頂点編集（次段階）まで面ハンドルによるリサイズを提供しない。
  if (part.type === 'mesh') return {};
  throw new Error(`未対応の形状です: ${part.type}`);
}

export function resizeHandleLayout(part, dimensions = resizeDimensions(part)) {
  if (part.type === 'mesh') return [];
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

// meshのBufferGeometryを構築する。曲面プリミティブと違い、法線は面ごとに独立させる
// （スムーズシェーディングにしない）ため、頂点は面ごとに複製する。四角形は三角形2枚に分割する。
// 各頂点がどの面（part.faces内インデックス）に属するかをuserData.meshFaceIndicesへ記録し、
// 面ごとのUV展開（applyAtlasUV）とビューポートの面選択・押し出しの両方から参照できるようにする。
function createMeshGeometry(part, THREE) {
  const positions = [], normals = [], uvs = [], faceIndices = [];
  part.faces.forEach((face, faceIndex) => {
    const points = face.map(index => part.vertices[index]);
    const normal = flatNormal(points[0], points[1], points[2]);
    const triangles = points.length === 3 ? [[0, 1, 2]] : [[0, 1, 2], [0, 2, 3]];
    for (const triangle of triangles) for (const cornerIndex of triangle) {
      positions.push(...points[cornerIndex]);
      normals.push(...normal);
      uvs.push(0, 0); // applyAtlasUVが位置・法線から実際のUVへ必ず上書きする。
      faceIndices.push(faceIndex);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  (geometry.userData ??= {}).meshFaceIndices = faceIndices;
  return geometry;
}
// Three.jsを引数で受け取り、ブラウザとNodeテストの双方から形状生成を検査できるようにする。
export function createPartGeometry(part, THREE) {
  let geometry;
  switch (part.type) {
    case 'box': geometry = new THREE.BoxGeometry(...part.size); break;
    case 'cylinder': geometry = new THREE.CylinderGeometry(part.radiusTop ?? part.radius, part.radiusBottom ?? part.radius, part.height, part.segments, 1); break;
    case 'sphere': geometry = new THREE.SphereGeometry(part.radius, part.segments, Math.max(4, Math.ceil(part.segments / 2))); break;
    case 'capsule': geometry = new THREE.CapsuleGeometry(part.radius, part.height, part.segments, part.segments); break;
    case 'mesh': geometry = createMeshGeometry(part, THREE); break;
    default: throw new Error(`未対応の形状です: ${part.type}`);
  }
  // render_preview の Box3.expandByObject もこの形状別計算を使う。
  if (THREE.Box3 && THREE.Vector3) {
    const { min, max } = calculatePartBounds(part);
    geometry.boundingBox = new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max));
  }
  return geometry;
}
