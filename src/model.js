// ModelDoc だけを永続化し、描画用オブジェクトは含めない。
export const cloneDoc = (doc) => structuredClone(doc);
export const DEFAULT_TEXELS_PER_UNIT = 4;
export const DEFAULT_PALETTE = ['#e0a070', '#e8ce9e', '#c96c64', '#689caa', '#646f8c', '#849b69', '#b692bb', '#ece5d8'];
export const PALETTE_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
const integer = (value, min = -10000, max = 10000) => Number.isSafeInteger(value) && value >= min && value <= max;
export const partRadiusTop = part => part.radiusTop ?? part.radius;
export const partRadiusBottom = part => part.radiusBottom ?? part.radius;
// mesh型の実座標からバウンディングボックスを求める。半径のような「半径」概念が無いため、頂点の実min/maxをそのまま使う。
export const meshBounds = vertices => ({
  min: [0, 1, 2].map(axis => Math.min(...vertices.map(vertex => vertex[axis]))),
  max: [0, 1, 2].map(axis => Math.max(...vertices.map(vertex => vertex[axis]))),
});
export function textureLayout(part, texelsPerUnit = DEFAULT_TEXELS_PER_UNIT) {
  if (part.type === 'box') {
    const [w, h, d] = part.size.map(value => value * texelsPerUnit);
    return {
      size: [2 * (d + w), d + h],
      faces: {
        up: [d, 0, w, d], down: [d + w, 0, w, d],
        right: [0, d, d, h], front: [d, d, w, h],
        left: [d + w, d, d, h], back: [2 * d + w, d, w, h],
      },
    };
  }
  if (part.type === 'mesh') {
    // 箱からの変換直後は、バウンディングボックスが元のsizeと一致するため箱と同じ展開になる。
    const { min, max } = meshBounds(part.vertices);
    const [w, h, d] = [0, 1, 2].map(axis => (max[axis] - min[axis]) * texelsPerUnit);
    return {
      size: [2 * (d + w), d + h],
      faces: {
        up: [d, 0, w, d], down: [d + w, 0, w, d],
        right: [0, d, d, h], front: [d, d, w, h],
        left: [d + w, d, d, h], back: [2 * d + w, d, w, h],
      },
    };
  }
  if (part.type === 'sphere' || part.type === 'capsule') {
    const surfaceWidth = Math.max(1, Math.ceil(2 * Math.PI * part.radius * texelsPerUnit));
    const surfaceHeight = (part.type === 'sphere' ? part.radius * 2 : part.height + part.radius * 2) * texelsPerUnit;
    return { size: [surfaceWidth, surfaceHeight], faces: { surface: [0, 0, surfaceWidth, surfaceHeight] } };
  }
  const topRadius = partRadiusTop(part), bottomRadius = partRadiusBottom(part);
  const topDiameter = topRadius * 2 * texelsPerUnit, bottomDiameter = bottomRadius * 2 * texelsPerUnit;
  const maxDiameter = Math.max(topDiameter, bottomDiameter);
  const circumference = Math.max(1, Math.ceil(2 * Math.PI * Math.max(topRadius, bottomRadius) * texelsPerUnit));
  const sideHeight = Math.ceil(Math.hypot(part.height, topRadius - bottomRadius) * texelsPerUnit);
  return {
    size: [Math.max(circumference, topDiameter + bottomDiameter), maxDiameter + sideHeight],
    faces: {
      up: [0, 0, topDiameter, topDiameter], down: [topDiameter, 0, bottomDiameter, bottomDiameter],
      side: [0, maxDiameter, circumference, sideHeight],
    },
  };
}
export function createBlankTexture(part, texelsPerUnit = DEFAULT_TEXELS_PER_UNIT) {
  const [width, height] = textureLayout(part, texelsPerUnit).size;
  return { size: [width, height], rows: Array(height).fill('.'.repeat(width)) };
}
// Canvas に依存しないテクスチャ生成部分。旧形式では texture 自体が存在しない。
export function createPartTexturePixels(part, palette) {
  if (!part || part.texture === undefined) return null;
  const texture = part.texture;
  if (!texture) return null;
  const [width, height] = texture.size;
  return {
    size: [width, height],
    pixels: texture.rows.flatMap(row => [...row].map(character => character === '.' ? null : palette[PALETTE_CHARS.indexOf(character)])),
  };
}
export function resizePartTexture(part, texelsPerUnit = DEFAULT_TEXELS_PER_UNIT) {
  if (!part.texture) return false;
  const [width, height] = textureLayout(part, texelsPerUnit).size;
  const [oldWidth, oldHeight] = part.texture.size;
  if (width === oldWidth && height === oldHeight) return false;
  let pixelsLost = false;
  if (width < oldWidth || height < oldHeight) {
    for (let y = 0; y < oldHeight; y++) for (let x = 0; x < oldWidth; x++) {
      if ((x >= width || y >= height) && part.texture.rows[y][x] !== '.') pixelsLost = true;
    }
  }
  part.texture = {
    size: [width, height],
    rows: Array.from({ length: height }, (_, y) => {
      const copied = y < oldHeight ? part.texture.rows[y].slice(0, width) : '';
      return copied.padEnd(width, '.');
    }),
  };
  return pixelsLost;
}
function withDefaults(value) {
  const doc = cloneDoc(value);
  if (!doc || typeof doc !== 'object') return doc;
  if (doc.texelsPerUnit === undefined) doc.texelsPerUnit = DEFAULT_TEXELS_PER_UNIT;
  if (doc.palette === undefined) doc.palette = [...DEFAULT_PALETTE];
  if (doc.bones === undefined) doc.bones = [];
  if (doc.animations === undefined) doc.animations = [];
  if (Array.isArray(doc.parts)) for (const part of doc.parts) if (part?.bone === undefined) part.bone = null;
  return doc;
}
export function validateDoc(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('ModelDocはJSONオブジェクトにしてください。');
  if (doc.version !== 1) throw new Error('ModelDoc.versionは1にしてください。');
  if (typeof doc.name !== 'string' || !doc.name.trim() || doc.name.length > 100) throw new Error('ModelDoc.nameは1〜100文字の空白だけでない文字列にしてください。');
  if (!integer(doc.grid, 1)) throw new Error('ModelDoc.gridは1〜10000の整数にしてください。');
  if (!integer(doc.texelsPerUnit, 1, 64)) throw new Error('ModelDoc.texelsPerUnitは1〜64の整数にしてください。');
  if (!Array.isArray(doc.palette) || !doc.palette.length || doc.palette.length > 36) throw new Error('ModelDoc.paletteは1〜36色の配列にしてください。');
  const invalidColorIndex = doc.palette.findIndex(color => typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color));
  if (invalidColorIndex >= 0) throw new Error(`ModelDoc.palette[${invalidColorIndex}]は#rrggbb形式の色にしてください。`);
  if (!Array.isArray(doc.parts) || doc.parts.length > 1000) throw new Error('ModelDoc.partsは最大1000件の配列にしてください。');
  if (!Array.isArray(doc.bones) || doc.bones.length > 1000) throw new Error('ModelDoc.bonesは最大1000件の配列にしてください。');
  if (doc.animations !== undefined && !Array.isArray(doc.animations)) throw new Error('ModelDoc.animationsは配列にしてください。');
  const boneIds = new Set();
  for (const bone of doc.bones) {
    if (!bone || typeof bone.id !== 'string' || !bone.id || bone.id.length > 100 || boneIds.has(bone.id)) throw new Error('ボーンIDが空か重複しています。');
    boneIds.add(bone.id);
    if (typeof bone.name !== 'string' || !bone.name.trim() || bone.name.length > 100 || (bone.parent !== null && typeof bone.parent !== 'string')) throw new Error('ボーンの名前または親が不正です。');
    if (!Array.isArray(bone.position) || bone.position.length !== 3 || !bone.position.every(value => integer(value))) throw new Error('ボーン位置は−10000〜10000の整数にしてください。');
    if (!Array.isArray(bone.rotation) || bone.rotation.length !== 3 || !bone.rotation.every(value => Number.isFinite(value) && value >= 0 && value < 360)) throw new Error('ボーン回転は0〜359度にしてください。');
  }
  for (const bone of doc.bones) if (bone.parent !== null && !boneIds.has(bone.parent)) throw new Error(`${bone.name}の親ボーンが見つかりません。`);
  const visited = new Set(), visiting = new Set(), bonesById = new Map(doc.bones.map(bone => [bone.id, bone]));
  const visit = bone => {
    if (visiting.has(bone.id)) throw new Error('ボーン階層に循環参照があります。');
    if (visited.has(bone.id)) return;
    visiting.add(bone.id);
    if (bone.parent !== null) visit(bonesById.get(bone.parent));
    visiting.delete(bone.id); visited.add(bone.id);
  };
  for (const bone of doc.bones) visit(bone);
  const animationIds = new Set();
  for (const animation of doc.animations ?? []) {
    if (!animation || typeof animation.id !== 'string' || !animation.id || animation.id.length > 100 || animationIds.has(animation.id)) throw new Error('アニメーションIDが空か重複しています。');
    animationIds.add(animation.id);
    if (typeof animation.name !== 'string' || !animation.name.trim() || animation.name.length > 100 || !integer(animation.fps, 1, 240) || !integer(animation.length, 1, 10000) || !Array.isArray(animation.tracks)) throw new Error('アニメーションの名前・fps・長さ・トラックが不正です。');
    const trackBoneIds = new Set();
    for (const track of animation.tracks) {
      if (!track || typeof track.boneId !== 'string' || !boneIds.has(track.boneId) || trackBoneIds.has(track.boneId) || !Array.isArray(track.keys)) throw new Error('アニメーションのボーントラックが不正です。');
      trackBoneIds.add(track.boneId);
      const frames = new Set();
      for (const key of track.keys) {
        if (!key || !integer(key.frame, 0, animation.length - 1) || frames.has(key.frame) || !Array.isArray(key.rotation) || key.rotation.length !== 3 || !key.rotation.every(value => Number.isFinite(value) && value >= 0 && value < 360)) throw new Error('キーフレームのフレーム番号または回転が不正です。');
        frames.add(key.frame);
      }
    }
  }
  const ids = new Set();
  for (const part of doc.parts) {
    if (!part || typeof part.id !== 'string' || !part.id || part.id.length > 100 || ids.has(part.id)) throw new Error('パーツIDが空か重複しています。');
    ids.add(part.id);
    if (part.bone !== null && !boneIds.has(part.bone)) throw new Error(`${part.name ?? part.id}の所属ボーンが見つかりません。`);
    if (typeof part.name !== 'string' || !part.name.trim() || part.name.length > 100 || !['box', 'cylinder', 'sphere', 'capsule', 'mesh'].includes(part.type)) throw new Error('パーツの名前または種類が不正です。');
    for (const key of ['position', 'rotation']) {
      if (!Array.isArray(part[key]) || part[key].length !== 3 || !part[key].every(v => integer(v))) throw new Error('座標・回転は−10000〜10000の整数にしてください。');
    }
    if (part.type === 'box' && (!Array.isArray(part.size) || part.size.length !== 3 || !part.size.every(v => integer(v, 1)))) throw new Error('サイズは1〜10000の整数にしてください。');
    if (['cylinder', 'sphere', 'capsule'].includes(part.type) && (!integer(part.radius, 1) || !integer(part.segments, 3, 64))) throw new Error('半径は1〜10000、分割数は3〜64の整数にしてください。');
    if (['cylinder', 'capsule'].includes(part.type) && !integer(part.height, 1)) throw new Error('高さは1〜10000の整数にしてください。');
    if (part.type === 'cylinder') {
      if (part.radiusTop !== undefined && !integer(part.radiusTop, 0)) throw new Error('上半径は0〜10000の整数にしてください。');
      if (part.radiusBottom !== undefined && !integer(part.radiusBottom, 0)) throw new Error('下半径は0〜10000の整数にしてください。');
      if (partRadiusTop(part) === 0 && partRadiusBottom(part) === 0) throw new Error('上半径と下半径を同時に0にはできません。');
    }
    if (part.type === 'mesh') {
      if (!Array.isArray(part.vertices) || part.vertices.length < 3 || part.vertices.length > 2000) throw new Error('頂点は3〜2000個の配列にしてください。');
      if (!part.vertices.every(vertex => Array.isArray(vertex) && vertex.length === 3 && vertex.every(value => integer(value)))) throw new Error('頂点座標は−10000〜10000の整数にしてください。');
      if (!Array.isArray(part.faces) || part.faces.length < 1 || part.faces.length > 2000) throw new Error('面は1〜2000個の配列にしてください。');
      const vertexCount = part.vertices.length;
      if (!part.faces.every(face => Array.isArray(face) && (face.length === 3 || face.length === 4) && face.every(index => Number.isSafeInteger(index) && index >= 0 && index < vertexCount))) throw new Error('面は3または4個の頂点インデックス（範囲内）の配列にしてください。');
    }
    if (!/^#[0-9a-f]{6}$/i.test(part.color)) throw new Error('色は#rrggbb形式にしてください。');
    if (part.texture !== undefined) {
      const expected = textureLayout(part, doc.texelsPerUnit).size;
      const texture = part.texture;
      if (!texture || !Array.isArray(texture.size) || texture.size.length !== 2 || texture.size.some((value, index) => value !== expected[index]) || !Array.isArray(texture.rows) || texture.rows.length !== expected[1] || texture.rows.some(row => typeof row !== 'string' || row.length !== expected[0])) throw new Error(`${part.name}のテクスチャ寸法または行数が不正です。`);
      const allowed = new Set(`.${PALETTE_CHARS.slice(0, doc.palette.length)}`);
      if (texture.rows.some(row => [...row].some(character => !allowed.has(character)))) throw new Error(`${part.name}のテクスチャにパレット範囲外の文字があります。`);
    }
  }
  return doc;
}
// パーツIDの採番だけを行う。createPartはこれに独自形状の初期値を足す一方、
// duplicatePart/mirrorPartは既存パーツをそのまま複製するのでcreatePartを経由しない
// （経由すると、未対応形状（mesh等）を複製しようとした際にcreatePartの型検査で落ちてしまう）。
function nextPartId(doc) {
  let number = 1;
  while (doc.parts.some(p => p.id === `p${number}`)) number++;
  return `p${number}`;
}
export function createPart(doc, type) {
  if (!['box', 'cylinder', 'frustum', 'sphere', 'capsule'].includes(type)) throw new Error('未対応のパーツです。');
  const id = nextPartId(doc);
  const number = Number(id.slice(1));
  const labels = { box: '箱', cylinder: '円柱', frustum: '円錐台', sphere: '球', capsule: 'カプセル' };
  const storedType = type === 'frustum' ? 'cylinder' : type;
  const part = { id, name: `${labels[type]} ${number}`, type: storedType, position: [0, 2, 0], size: [2, 4, 2], radius: 2, height: 4, segments: type === 'sphere' ? 10 : 8, rotation: [0, 0, 0], color: '#e0a070', bone: null };
  if (type === 'frustum') Object.assign(part, { radiusTop: 1, radiusBottom: 2 });
  part.texture = createBlankTexture(part, doc.texelsPerUnit ?? DEFAULT_TEXELS_PER_UNIT);
  return part;
}
// 箱→メッシュ変換。頂点8個・面6個（四角形）を生成する。
// 面の頂点は必ず「外から見て反時計回り」（法線が外を向く）の順で並べること。
// 奇数サイズでは中心を整数格子に厳密には合わせられないため、下側を切り捨てて上側へ寄せる
// （頂点座標を整数にすることを優先し、中心が最大0.5ずれるのは許容する）。
export function convertBoxToMesh(part) {
  if (part.type !== 'box') throw new Error(`「${part.name}」は箱ではないため、メッシュへ変換できません（現在は箱からの変換のみ対応しています）。`);
  const low = part.size.map(value => -Math.floor(value / 2));
  const high = part.size.map((value, axis) => value + low[axis]);
  const [lx, ly, lz] = low, [hx, hy, hz] = high;
  const vertices = [
    [lx, ly, lz], [hx, ly, lz], [hx, hy, lz], [lx, hy, lz], // 0-3: z = lz（背面側）
    [lx, ly, hz], [hx, ly, hz], [hx, hy, hz], [lx, hy, hz], // 4-7: z = hz（正面側）
  ];
  const faces = [
    [4, 5, 6, 7], // front (+Z)
    [1, 0, 3, 2], // back (-Z)
    [3, 7, 6, 2], // up (+Y)
    [0, 1, 5, 4], // down (-Y)
    [1, 2, 6, 5], // right (+X)
    [0, 4, 7, 3], // left (-X)
  ];
  const next = structuredClone(part);
  delete next.size;
  next.type = 'mesh';
  next.vertices = vertices;
  next.faces = faces;
  return next;
}
export function createBone(doc, parent = null) {
  let number = 1;
  while (doc.bones.some(bone => bone.id === `b${number}`)) number++;
  return { id: `b${number}`, name: `ボーン ${number}`, parent, position: [0, parent ? 2 : 0, 0], rotation: [0, 0, 0] };
}

export function createNewDoc() {
  const doc = {
    version: 1, name: 'untitled', grid: 1, texelsPerUnit: DEFAULT_TEXELS_PER_UNIT,
    palette: [...DEFAULT_PALETTE], parts: [], bones: [], animations: [],
  };
  doc.parts.push(createPart(doc, 'box'));
  return validateDoc(doc);
}

// Three.jsに依存しないFK計算。行列は列優先で、T * Rz * Ry * Rx の順に合成する。
const multiplyMatrix4 = (a, b) => {
  const result = Array(16).fill(0);
  for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++) {
    for (let index = 0; index < 4; index++) result[column * 4 + row] += a[index * 4 + row] * b[column * 4 + index];
  }
  return result;
};
const localBoneMatrix = bone => {
  const [x, y, z] = bone.rotation.map(value => value * Math.PI / 180);
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  return [
    cz * cy, sz * cy, -sy, 0,
    cz * sy * sx - sz * cx, sz * sy * sx + cz * cx, cy * sx, 0,
    cz * sy * cx + sz * sx, sz * sy * cx - cz * sx, cy * cx, 0,
    bone.position[0], bone.position[1], bone.position[2], 1,
  ];
};
export function calculateBoneWorldTransforms(doc) {
  const byId = new Map(doc.bones.map(bone => [bone.id, bone])), result = new Map();
  const calculate = bone => {
    if (result.has(bone.id)) return result.get(bone.id);
    const matrix = bone.parent === null ? localBoneMatrix(bone) : multiplyMatrix4(calculate(byId.get(bone.parent)).matrix, localBoneMatrix(bone));
    const transform = { matrix, position: [matrix[12], matrix[13], matrix[14]] };
    result.set(bone.id, transform); return transform;
  };
  for (const bone of doc.bones) calculate(bone);
  return result;
}
function uniquePartName(doc, preferredName) {
  const names = new Set(doc.parts.map(part => part.name));
  if (!names.has(preferredName)) return preferredName;
  for (let number = 2; ; number++) {
    const suffix = ` ${number}`;
    const base = preferredName.slice(0, 100 - suffix.length).trimEnd();
    const candidate = `${base}${suffix}`;
    if (!names.has(candidate)) return candidate;
  }
}
function mirroredName(name) {
  let matched = false;
  let result = name.replace(/[左右]/g, side => {
    matched = true;
    return side === '左' ? '右' : '左';
  });
  result = result.replace(/_(left|right|l|r)$/, suffix => {
    matched = true;
    return { _left: '_right', _right: '_left', _l: '_r', _r: '_l' }[suffix];
  });
  return { name: result, matched };
}
export function duplicatePart(doc, source) {
  return { ...structuredClone(source), id: nextPartId(doc), name: uniquePartName(doc, source.name) };
}
export function mirrorPart(doc, source) {
  const swapped = mirroredName(source.name);
  const copy = duplicatePart(doc, source);
  copy.name = uniquePartName(doc, swapped.matched ? swapped.name : source.name);
  copy.position[0] = -copy.position[0];
  copy.rotation[1] = ((-copy.rotation[1] % 360) + 360) % 360;
  copy.rotation[2] = ((-copy.rotation[2] % 360) + 360) % 360;
  if (copy.type === 'mesh') {
    // X符号反転だけでは面が裏返る（法線が内側を向く）ため、頂点順序も反転して打ち消す。
    copy.vertices = copy.vertices.map(([x, y, z]) => [-x, y, z]);
    copy.faces = copy.faces.map(face => [...face].reverse());
  }
  return copy;
}
export function createSampleDoc() {
  const doc = {
    version: 1, name: 'untitled', grid: 1, texelsPerUnit: DEFAULT_TEXELS_PER_UNIT, palette: [...DEFAULT_PALETTE], parts: [],
    bones: [
      { id: 'b1', name: '腰', parent: null, position: [0, 4, 0], rotation: [0, 0, 0] },
      { id: 'b2', name: '胴', parent: 'b1', position: [0, 3, 0], rotation: [0, 0, 0] },
      { id: 'b3', name: '頭', parent: 'b2', position: [0, 5, 0], rotation: [0, 0, 0] },
      { id: 'b4', name: '左腕', parent: 'b2', position: [-4, 0, 0], rotation: [0, 0, 0] },
      { id: 'b5', name: '右腕', parent: 'b2', position: [4, 0, 0], rotation: [0, 0, 0] },
      { id: 'b6', name: '左脚', parent: 'b1', position: [-2, -2, 0], rotation: [0, 0, 0] },
      { id: 'b7', name: '右脚', parent: 'b1', position: [2, -2, 0], rotation: [0, 0, 0] },
    ],
    animations: [{
      id: 'a1', name: 'walk', fps: 12, length: 12,
      tracks: [
        { boneId: 'b4', keys: [{ frame: 0, rotation: [25, 0, 0] }, { frame: 6, rotation: [335, 0, 0] }, { frame: 11, rotation: [25, 0, 0] }] },
        { boneId: 'b5', keys: [{ frame: 0, rotation: [335, 0, 0] }, { frame: 6, rotation: [25, 0, 0] }, { frame: 11, rotation: [335, 0, 0] }] },
        { boneId: 'b6', keys: [{ frame: 0, rotation: [335, 0, 0] }, { frame: 6, rotation: [25, 0, 0] }, { frame: 11, rotation: [335, 0, 0] }] },
        { boneId: 'b7', keys: [{ frame: 0, rotation: [25, 0, 0] }, { frame: 6, rotation: [335, 0, 0] }, { frame: 11, rotation: [25, 0, 0] }] },
      ],
    }],
  };
  const samples = [
    ['頭', [0, 12, 0], [4, 4, 4], '#e0a070'],
    ['胴', [0, 7, 0], [4, 6, 2], '#689caa'],
    ['左腕', [-4, 7, 0], [2, 6, 2], '#e0a070'],
    ['右腕', [4, 7, 0], [2, 6, 2], '#e0a070'],
    ['左脚', [-2, 2, 0], [2, 4, 2], '#646f8c'],
    ['右脚', [2, 2, 0], [2, 4, 2], '#646f8c'],
  ];
  const boneByPartName = { '頭': 'b3', '胴': 'b2', '左腕': 'b4', '右腕': 'b5', '左脚': 'b6', '右脚': 'b7' };
  for (const [name, position, size, color] of samples) {
    const part = { ...createPart(doc, 'box'), name, position, size, color, bone: boneByPartName[name] };
    part.texture = createBlankTexture(part, doc.texelsPerUnit);
    doc.parts.push(part);
  }
  return validateDoc(doc);
}
export function createChestSampleDoc() {
  const wood = '#8b5a2b', lightWood = '#a86f32', metal = '#d4a72c';
  const doc = {
    version: 1,
    name: '宝箱サンプル',
    grid: 1,
    texelsPerUnit: DEFAULT_TEXELS_PER_UNIT,
    palette: [...DEFAULT_PALETTE, wood, lightWood, metal],
    parts: [], bones: [], animations: [],
  };
  const samples = [
    ['本体', [0, 3, 0], [10, 6, 6], wood],
    ['蓋', [0, 7, 0], [10, 2, 8], lightWood],
    ['錠前', [0, 4, 3], [2, 2, 2], metal],
  ];
  for (const [name, position, size, color] of samples) {
    const part = { ...createPart(doc, 'box'), name, position, size, color };
    part.texture = createBlankTexture(part, doc.texelsPerUnit);
    doc.parts.push(part);
  }
  return validateDoc(doc);
}
export function createTeapotSampleDoc() {
  const porcelain = '#ece5d8', accent = '#c96c64';
  const doc = {
    version: 1,
    name: 'ティーポットサンプル',
    grid: 1,
    texelsPerUnit: DEFAULT_TEXELS_PER_UNIT,
    palette: [...DEFAULT_PALETTE],
    parts: [], bones: [], animations: [],
  };
  const samples = [
    { name: '本体', type: 'sphere', position: [0, 4, 0], radius: 4, segments: 10, color: porcelain },
    { name: '台座', type: 'cylinder', position: [0, 1, 0], radius: 3, radiusTop: 3, radiusBottom: 2, height: 1, segments: 10, color: accent },
    { name: '蓋', type: 'cylinder', position: [0, 7, 0], radius: 2, radiusTop: 1, radiusBottom: 3, height: 1, segments: 10, color: accent },
    { name: 'つまみ', type: 'sphere', position: [0, 8, 0], radius: 1, segments: 8, color: accent },
    { name: '注ぎ口', type: 'cylinder', position: [5, 5, 0], radius: 2, radiusTop: 1, radiusBottom: 2, height: 6, segments: 10, rotation: [0, 0, 300], color: porcelain },
    { name: '取っ手（上）', type: 'capsule', position: [-4, 6, 0], radius: 1, height: 3, segments: 8, rotation: [0, 0, 60], color: porcelain },
    { name: '取っ手（外）', type: 'capsule', position: [-6, 4, 0], radius: 1, height: 4, segments: 8, color: porcelain },
    { name: '取っ手（下）', type: 'capsule', position: [-4, 2, 0], radius: 1, height: 3, segments: 8, rotation: [0, 0, 120], color: porcelain },
  ];
  for (const sample of samples) {
    const { name, type, ...properties } = sample;
    const part = { ...createPart(doc, type), name, ...properties };
    part.texture = createBlankTexture(part, doc.texelsPerUnit);
    doc.parts.push(part);
  }
  return validateDoc(doc);
}
export const serializeDoc = doc => JSON.stringify(validateDoc(doc), null, 2);
export const deserializeDoc = text => validateDoc(withDefaults(JSON.parse(text)));

const radians = degrees => degrees * Math.PI / 180;
const degrees = value => {
  const normalized = ((value * 180 / Math.PI % 360) + 360) % 360;
  return normalized < 1e-10 || 360 - normalized < 1e-10 ? 0 : normalized;
};
// ブラウザでは Three.js の Quaternion / Euler を渡し、同じ XYZ 順で最短弧を補間する。
export function interpolateRotation(keys, frame, three = null) {
  if (!keys.length) return [0, 0, 0];
  const sorted = [...keys].sort((left, right) => left.frame - right.frame);
  if (frame <= sorted[0].frame) return [...sorted[0].rotation];
  if (frame >= sorted.at(-1).frame) return [...sorted.at(-1).rotation];
  const afterIndex = sorted.findIndex(key => key.frame >= frame);
  const before = sorted[afterIndex - 1], after = sorted[afterIndex];
  if (after.frame === frame) return [...after.rotation];
  const alpha = (frame - before.frame) / (after.frame - before.frame);
  if (three?.Quaternion && three?.Euler) {
    const from = new three.Quaternion().setFromEuler(new three.Euler(...before.rotation.map(radians), 'XYZ'));
    const to = new three.Quaternion().setFromEuler(new three.Euler(...after.rotation.map(radians), 'XYZ'));
    from.slerp(to, alpha);
    const result = new three.Euler().setFromQuaternion(from, 'XYZ');
    return [result.x, result.y, result.z].map(degrees);
  }
  // Nodeテスト用の依存なし実装。Three.jsと同じXYZ Euler→Quaternion→slerp→Eulerを行う。
  const quaternion = rotation => {
    const [x, y, z] = rotation.map(value => radians(value) / 2);
    const c1 = Math.cos(x), c2 = Math.cos(y), c3 = Math.cos(z), s1 = Math.sin(x), s2 = Math.sin(y), s3 = Math.sin(z);
    return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
  };
  let left = quaternion(before.rotation), right = quaternion(after.rotation);
  let dot = left.reduce((sum, value, index) => sum + value * right[index], 0);
  if (dot < 0) { right = right.map(value => -value); dot = -dot; }
  let blended;
  if (dot > .9995) blended = left.map((value, index) => value + alpha * (right[index] - value));
  else {
    const theta = Math.acos(Math.min(1, dot)), denominator = Math.sin(theta);
    const a = Math.sin((1 - alpha) * theta) / denominator, b = Math.sin(alpha * theta) / denominator;
    blended = left.map((value, index) => a * value + b * right[index]);
  }
  const length = Math.hypot(...blended); const [x, y, z, w] = blended.map(value => value / length);
  const matrix13 = 2 * (x * z + w * y);
  const euler = Math.abs(matrix13) < .9999999
    ? [Math.atan2(-2 * (y * z - w * x), 1 - 2 * (x * x + y * y)), Math.asin(matrix13), Math.atan2(-2 * (x * y - w * z), 1 - 2 * (y * y + z * z))]
    : [Math.atan2(2 * (x * y + w * z), 1 - 2 * (x * x + z * z)), Math.asin(matrix13), 0];
  return euler.map(degrees);
}

// フレーム移動専用。履歴を経由せず、表示姿勢だけを持つ新しいModelDocを返す。
export function applyAnimationFrame(doc, animationId, frame, three = null) {
  const next = cloneDoc(doc), animation = next.animations?.find(candidate => candidate.id === animationId);
  if (!animation) return next;
  const clampedFrame = Math.max(0, Math.min(animation.length - 1, Math.trunc(frame)));
  const tracks = new Map(animation.tracks.map(track => [track.boneId, track]));
  for (const bone of next.bones) bone.rotation = interpolateRotation(tracks.get(bone.id)?.keys ?? [], clampedFrame, three);
  return next;
}
