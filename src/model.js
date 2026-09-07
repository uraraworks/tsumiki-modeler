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
// 3次元ベクトルの最小限の演算。geometry.jsもこれを使い、法線計算を1箇所へ集約する
// （model.js→geometry.jsの逆方向importは循環になるため、法線計算はここに置く）。
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize3 = v => { const length = Math.hypot(...v) || 1; return v.map(c => c / length); };
// 平面な四角形/三角形の頂点列から面ごとのフラット法線を求める（3頂点で十分：面は平面である前提）。
export function flatNormal(p0, p1, p2) {
  return normalize3(cross3(sub3(p1, p0), sub3(p2, p0)));
}
// 面をその法線に垂直な2軸（面の最初の辺をU軸、法線×U軸をV軸）へ投影する。
// 軸に平行な矩形面なら、U軸が辺そのものと一致するため、投影後の幅・高さが辺の実長と厳密に一致する
// （法線方向へ単純投影する方式だと、斜めの面でテクセルが実寸より縮んでしまうため採用しない）。
function projectFace(vertices) {
  const origin = vertices[0];
  const normal = flatNormal(vertices[0], vertices[1], vertices[2]);
  const edge = sub3(vertices[1], vertices[0]);
  const edgeLength = Math.hypot(...edge) || 1;
  const u = edge.map(c => c / edgeLength);
  const v = cross3(normal, u);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const vertex of vertices) {
    const d = sub3(vertex, origin);
    const projectedU = dot3(d, u), projectedV = dot3(d, v);
    minU = Math.min(minU, projectedU); maxU = Math.max(maxU, projectedU);
    minV = Math.min(minV, projectedV); maxV = Math.max(maxV, projectedV);
  }
  return { origin, u, v, normal, minU, minV, width: maxU - minU, height: maxV - minV };
}
// 面ごとの矩形をアトラスへ単純な棚（シェルフ）詰めする。最適な詰め方は狙わず、
// 「面ごとに歪みのない矩形サイズを確保できていること」だけを保証する。
function packRects(rects) {
  const order = rects.map((_, index) => index).sort((a, b) => rects[b].h - rects[a].h || rects[b].w - rects[a].w);
  const totalArea = rects.reduce((sum, rect) => sum + rect.w * rect.h, 0);
  const targetWidth = Math.max(1, ...rects.map(rect => rect.w), Math.ceil(Math.sqrt(totalArea)));
  const positions = Array(rects.length);
  let x = 0, y = 0, shelfHeight = 0, atlasWidth = 0;
  for (const index of order) {
    const rect = rects[index];
    if (x > 0 && x + rect.w > targetWidth) { x = 0; y += shelfHeight; shelfHeight = 0; }
    positions[index] = { x, y };
    atlasWidth = Math.max(atlasWidth, x + rect.w);
    x += rect.w;
    shelfHeight = Math.max(shelfHeight, rect.h);
  }
  return { width: atlasWidth, height: y + shelfHeight, positions };
}
// mesh用：面ごとに平面展開したUVアトラスを求める。箱と違い曲面プリミティブの軸投影を使わないため、
// 押し出しでできた斜めの面でもテクセルが歪まない。軸に平行な矩形面（箱からの変換直後）では、
// projectFaceがその面の辺の実長をそのまま返すため、従来の6面展開と同じ領域サイズになる。
export function meshFaceLayout(part, texelsPerUnit = DEFAULT_TEXELS_PER_UNIT) {
  const projections = part.faces.map(face => projectFace(face.map(index => part.vertices[index])));
  const rects = projections.map(projection => ({
    w: Math.max(1, Math.round(projection.width * texelsPerUnit)),
    h: Math.max(1, Math.round(projection.height * texelsPerUnit)),
  }));
  const packed = packRects(rects);
  const faces = {};
  packed.positions.forEach((position, index) => { faces[index] = [position.x, position.y, rects[index].w, rects[index].h]; });
  return { size: [Math.max(1, packed.width), Math.max(1, packed.height)], faces, projections };
}
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
    // 各面を法線に垂直な2軸へ平面展開する（meshFaceLayout参照）。箱から変換した直後は
    // 全面が軸に平行な矩形のため、各面の領域サイズは従来の6面展開と一致する。
    const layout = meshFaceLayout(part, texelsPerUnit);
    return { size: layout.size, faces: layout.faces, projections: layout.projections };
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
      // 頂点編集で頂点が重なる／一直線上に並ぶと面が面積0に潰れる。押し出しや箱変換では起こらないが、
      // 頂点移動では起こりうるため、コマンド適用時（validateDocは常にapplyCommandの最後で走る）に検出して弾く。
      const degenerateFaces = degenerateMeshFaceIndices(part);
      if (degenerateFaces.length) throw new Error(`${part.name}の面（${degenerateFaces.join(', ')}）が面積0に潰れています。頂点の位置を見直してください。`);
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
export function convertBoxToMesh(part, texelsPerUnit = DEFAULT_TEXELS_PER_UNIT) {
  if (part.type !== 'box') throw new Error(`「${part.name}」は箱ではないため、メッシュへ変換できません（現在は箱からの変換のみ対応しています）。`);
  const low = part.size.map(value => -Math.floor(value / 2));
  const high = part.size.map((value, axis) => value + low[axis]);
  const [lx, ly, lz] = low, [hx, hy, hz] = high;
  const vertices = [
    [lx, ly, lz], [hx, ly, lz], [hx, hy, lz], [lx, hy, lz], // 0-3: z = lz（背面側）
    [lx, ly, hz], [hx, ly, hz], [hx, hy, hz], [lx, hy, hz], // 4-7: z = hz（正面側）
  ];
  // faceNameOrderは下のfaces配列の並びと対応する。箱のUV名前付き領域→meshの面インデックスへ
  // テクスチャ内容を写すための対応表として使う（面ごとの領域サイズは常に一致する）。
  const faceNameOrder = ['front', 'back', 'up', 'down', 'right', 'left'];
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
  if (part.texture) {
    // 面ごとの平面展開は箱の6面展開とアトラス全体の並べ方（詰め方）が異なるため、
    // 見た目を保つには箱の名前付き領域からmeshの面インデックス領域へドットを転写し直す必要がある
    // （各面の領域サイズ自体は一致するため、取りこぼしは発生しない）。
    const boxLayout = textureLayout(part, texelsPerUnit);
    const meshLayout = textureLayout(next, texelsPerUnit);
    const [width, height] = meshLayout.size;
    const grid = Array.from({ length: height }, () => Array(width).fill('.'));
    faceNameOrder.forEach((name, faceIndex) => {
      const [ox, oy, ow, oh] = boxLayout.faces[name];
      const [nx, ny, nw, nh] = meshLayout.faces[faceIndex];
      // 面ごとのU/V軸の取り方（最初の辺を基準にする）は面ごとに独立のため、同じ矩形でも
      // 90度回転（幅と高さの入れ替わり）で配置されることがある。転写時はそれを検出して補正する。
      const transposed = ow === nh && oh === nw && ow !== nw;
      for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
        const character = part.texture.rows[oy + y][ox + x];
        if (transposed) grid[ny + x][nx + y] = character;
        else if (x < nw && y < nh) grid[ny + y][nx + x] = character;
      }
    });
    next.texture = { size: [width, height], rows: grid.map(row => row.join('')) };
  }
  return next;
}
// 円柱・円錐台・球・カプセルは共通して「軸まわりの回転体（同心円の輪の積み重ね）」として作れる。
// rows は下から上へ並んだ{y, radius}の配列（radiusが実質0＝極/頂点なら1頂点の扇として繋ぐ）。
// これを1箇所に集約することで、3形状すべてのメッシュ化ロジックを使い回せる。
function buildRevolutionMesh(segments, rows) {
  const vertices = [];
  const built = rows.map(({ y, radius }) => {
    if (radius <= 1e-9) { vertices.push([0, y, 0]); return { pole: vertices.length - 1 }; }
    const ring = [];
    for (let i = 0; i < segments; i++) {
      const angle = i / segments * 2 * Math.PI;
      vertices.push([radius * Math.cos(angle), y, radius * Math.sin(angle)]);
      ring.push(vertices.length - 1);
    }
    return { ring };
  });
  const faces = [];
  for (let row = 0; row < built.length - 1; row++) {
    const a = built[row], b = built[row + 1];
    if (a.ring && b.ring) {
      for (let i = 0; i < segments; i++) { const j = (i + 1) % segments; faces.push([a.ring[i], a.ring[j], b.ring[j], b.ring[i]]); }
    } else if (a.pole !== undefined && b.ring) {
      for (let i = 0; i < segments; i++) { const j = (i + 1) % segments; faces.push([a.pole, b.ring[i], b.ring[j]]); }
    } else if (a.ring && b.pole !== undefined) {
      for (let i = 0; i < segments; i++) { const j = (i + 1) % segments; faces.push([b.pole, a.ring[j], a.ring[i]]); }
    }
  }
  return { vertices, faces };
}
// 曲面プリミティブ（円柱・円錐台・球・カプセル）を、丸め・重複除去の前段の実数頂点で生成する。
// segments件のリング分割はThree.jsのジオメトリと厳密には一致しないが、見た目の輪郭（半径・高さの
// 変化）は一致させてあるため、変換前後で原形は保たれる。
function curvedPrimitiveMeshData(part) {
  const n = part.segments;
  if (part.type === 'cylinder') {
    const half = part.height / 2, top = partRadiusTop(part), bottom = partRadiusBottom(part);
    const rows = [];
    if (bottom > 0) rows.push({ y: -half, radius: 0 }); // 下ぶたの中心（下半径が0なら頂点自体が中心になるため省く）
    rows.push({ y: -half, radius: bottom });
    rows.push({ y: half, radius: top });
    if (top > 0) rows.push({ y: half, radius: 0 }); // 上ぶたの中心
    return buildRevolutionMesh(n, rows);
  }
  if (part.type === 'sphere') {
    const heightSegments = Math.max(4, Math.ceil(n / 2)); // geometry.jsのSphereGeometry呼び出しと同じ規則
    const rows = Array.from({ length: heightSegments + 1 }, (_, iy) => {
      const theta = iy / heightSegments * Math.PI; // 0=北極 → π=南極
      return { y: part.radius * Math.cos(theta), radius: part.radius * Math.sin(theta) };
    });
    return buildRevolutionMesh(n, rows);
  }
  if (part.type === 'capsule') {
    const r = part.radius, half = part.height / 2, m = Math.max(2, n);
    const rows = [];
    for (let iy = 0; iy <= m; iy++) { const theta = iy / m * (Math.PI / 2); rows.push({ y: half + r * Math.cos(theta), radius: r * Math.sin(theta) }); } // 上極→胴上端
    rows.push({ y: -half, radius: r }); // 胴下端（胴上端と重複しないよう別行として持つ）
    for (let iy = 1; iy <= m; iy++) { const theta = iy / m * (Math.PI / 2); rows.push({ y: -half - r * Math.sin(theta), radius: r * Math.cos(theta) }); } // 胴下端→下極
    return buildRevolutionMesh(n, rows);
  }
  throw new Error(`未対応の形状です: ${part.type}`);
}
// 凸形状（円柱・円錐台・球・カプセルはいずれも凸）限定の簡便な法線補正。頂点全体の重心から見て
// 面が内向きなら頂点順序を反転する。曲面プリミティブの生成では辺の巻き方向を厳密に管理しない代わりに
// この後処理で必ず外向きへ揃える（extrudeMeshFaceのテストにある「法線は外側を向く」検証と同じ考え方）。
function autoOrientFaces(vertices, faces) {
  const center = [0, 1, 2].map(axis => vertices.reduce((sum, v) => sum + v[axis], 0) / vertices.length);
  return faces.map(face => {
    const points = face.map(index => vertices[index]);
    const normal = flatNormal(points[0], points[1], points[2]);
    const centroid = [0, 1, 2].map(axis => points.reduce((sum, p) => sum + p[axis], 0) / points.length);
    const outward = [0, 1, 2].map(axis => centroid[axis] - center[axis]);
    const dot = normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2];
    return dot < 0 ? [...face].reverse() : face;
  });
}
// 頂点座標を整数に丸めた後、同一座標に重なった頂点をマージし、3頂点未満に潰れた面を除去する。
// faceMap[新面index] = 旧面index（元の面との対応。mergePartsのテクスチャ転写に使う）。
function dedupeAndFilterMesh(vertices, faces) {
  const keyOf = v => v.join(',');
  const seen = new Map();
  const dedupedVertices = [];
  const remapIndex = vertices.map(vertex => {
    const key = keyOf(vertex);
    if (seen.has(key)) return seen.get(key);
    const index = dedupedVertices.length;
    dedupedVertices.push(vertex);
    seen.set(key, index);
    return index;
  });
  const dedupedFaces = [], faceMap = [];
  faces.forEach((face, originalIndex) => {
    const remapped = face.map(index => remapIndex[index]);
    const unique = [];
    for (const index of remapped) if (!unique.includes(index)) unique.push(index);
    if (unique.length < 3) return; // 全頂点が同じ点に潰れた（退化）面は捨てる
    dedupedFaces.push(unique.length === remapped.length ? remapped : unique);
    faceMap.push(originalIndex);
  });
  return { vertices: dedupedVertices, faces: dedupedFaces, faceMap };
}
// 曲面プリミティブ（円柱・円錐台・球・カプセル）をメッシュへ変換する見積もり。
// 実際に頂点・面を生成して数えるため多少のコストはあるが、確認ダイアログの前に軽く呼べる程度には速い。
export function estimateMeshConversion(part) {
  if (part.type === 'box') return { vertices: 8, faces: 6 };
  if (part.type === 'mesh') return { vertices: part.vertices.length, faces: part.faces.length };
  const raw = curvedPrimitiveMeshData(part);
  return { vertices: raw.vertices.length, faces: raw.faces.length };
}
// 円柱・円錐台・球・カプセルのメッシュ変換。箱と違い正確な座標に頂点を置けないため、
// 生成後に整数丸め→重複頂点マージ→退化面除去の順で処理する（丸めで面が潰れた場合は、
// 面ごと除去して形状を保つ。全体が潰れる場合はエラーで変換を拒否する）。
// テクスチャは新しいメッシュのUV配置が旧来の展開と全く異なるため転写できない。着色済みだった場合は
// pixelsLost:true を返し、呼び出し側（main.js）でステータス表示する（宣言どおり、色は
// パーツのcolorとしてフォールバックする＝無地の見た目は保たれる）。
function convertCurvedToMesh(part, texelsPerUnit) {
  const raw = curvedPrimitiveMeshData(part);
  const rounded = raw.vertices.map(vertex => vertex.map(Math.round));
  const { vertices, faces: dedupedFaces } = dedupeAndFilterMesh(rounded, raw.faces);
  let faces = autoOrientFaces(vertices, dedupedFaces);
  const degenerate = new Set(degenerateMeshFaceIndices({ type: 'mesh', vertices, faces }));
  if (degenerate.size) faces = faces.filter((_, index) => !degenerate.has(index));
  if (vertices.length < 4 || faces.length < 4) {
    throw new Error(`「${part.name}」は丸め誤差で形状が潰れてしまい、メッシュへ変換できません。分割数を増やすか、寸法を大きくしてください。`);
  }
  const next = structuredClone(part);
  delete next.size; delete next.radius; delete next.radiusTop; delete next.radiusBottom; delete next.height; delete next.segments;
  next.type = 'mesh';
  next.vertices = vertices;
  next.faces = faces;
  const hadPaint = !!part.texture && part.texture.rows.some(row => [...row].some(character => character !== '.'));
  next.texture = createBlankTexture(next, texelsPerUnit);
  return { part: next, pixelsLost: hadPaint };
}
// 箱・円柱・円錐台・球・カプセルすべてのメッシュ変換の入口。箱は既存のconvertBoxToMesh
// （テクスチャを面ごとに転写できる）をそのまま使い、曲面は上のconvertCurvedToMeshに委譲する。
export function convertPartToMesh(part, texelsPerUnit = DEFAULT_TEXELS_PER_UNIT) {
  if (part.type === 'mesh') throw new Error(`「${part.name}」はすでにメッシュです。`);
  if (part.type === 'box') return { part: convertBoxToMesh(part, texelsPerUnit), pixelsLost: false };
  if (!['cylinder', 'sphere', 'capsule'].includes(part.type)) throw new Error(`「${part.name}」は未対応の形状のため、メッシュへ変換できません。`);
  return convertCurvedToMesh(part, texelsPerUnit);
}
// 押し出しは常に面の法線に最も近い座標軸方向へスナップする。頂点は必ず整数のまま
// （軸方向×整数distanceの加算のみ）にするため、面が完全な軸平行でなくても安全側に丸める。
function axisSnappedNormal(normal) {
  const magnitudes = normal.map(Math.abs);
  const axis = magnitudes.indexOf(Math.max(...magnitudes));
  const snapped = [0, 0, 0];
  snapped[axis] = normal[axis] >= 0 ? 1 : -1;
  return snapped;
}
// 面構成が変わったmeshのテクスチャを新しいUVアトラスへ引き継ぐ。
// faceIndexMap: 新しい面インデックス→元の面インデックス（対応が無ければ未指定のまま'.'で埋める）。
// 押し出しでは移動した面の footprint（投影サイズ）が変わらないため、対応する面は取りこぼしなく複写できる。
function rebuildMeshTexture(oldPart, newPart, texelsPerUnit, faceIndexMap) {
  const newLayout = meshFaceLayout(newPart, texelsPerUnit);
  const [width, height] = newLayout.size;
  if (!oldPart.texture) return { size: [width, height], rows: Array(height).fill('.'.repeat(width)), pixelsLost: false };
  const oldLayout = meshFaceLayout(oldPart, texelsPerUnit);
  const grid = Array.from({ length: height }, () => Array(width).fill('.'));
  let pixelsLost = false;
  const mappedOldIndices = new Set();
  for (const [newIndex, oldIndex] of faceIndexMap) {
    const oldRegion = oldLayout.faces[oldIndex], newRegion = newLayout.faces[newIndex];
    if (!oldRegion || !newRegion) continue;
    mappedOldIndices.add(oldIndex);
    const [ox, oy, ow, oh] = oldRegion, [nx, ny, nw, nh] = newRegion;
    const copyWidth = Math.min(ow, nw), copyHeight = Math.min(oh, nh);
    for (let y = 0; y < copyHeight; y++) for (let x = 0; x < copyWidth; x++) {
      grid[ny + y][nx + x] = oldPart.texture.rows[oy + y][ox + x];
    }
    for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
      if ((x >= copyWidth || y >= copyHeight) && oldPart.texture.rows[oy + y][ox + x] !== '.') pixelsLost = true;
    }
  }
  for (let oldIndex = 0; oldIndex < oldPart.faces.length; oldIndex++) {
    if (mappedOldIndices.has(oldIndex)) continue;
    const region = oldLayout.faces[oldIndex];
    if (!region) continue;
    const [x, y, w, h] = region;
    outer: for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      if (oldPart.texture.rows[y + dy][x + dx] !== '.') { pixelsLost = true; break outer; }
    }
  }
  return { size: [width, height], rows: grid.map(row => row.join('')), pixelsLost };
}
// 選択した面（複数可）をそれぞれの法線方向へ押し出す。各面は独立に処理する
// （面同士が頂点を共有していても、押し出し後は別々の頂点として複製する）。
// 元の面は同じ配列位置のまま新しい位置の面に置き換え、辺ごとに側面の四角形を追加する。
export function extrudeMeshFace(part, faceIndices, distance, texelsPerUnit = DEFAULT_TEXELS_PER_UNIT) {
  if (part.type !== 'mesh') throw new Error(`「${part.name}」はメッシュではないため、面を押し出せません。`);
  if (!Number.isSafeInteger(distance)) throw new Error('押し出し距離は整数にしてください。');
  const uniqueIndices = [...new Set(faceIndices)];
  if (!uniqueIndices.length || !uniqueIndices.every(index => Number.isSafeInteger(index) && index >= 0 && index < part.faces.length)) {
    throw new Error('押し出す面の指定が不正です。');
  }
  if (distance === 0) return { part: structuredClone(part), pixelsLost: false };
  const sourceFaces = part.faces, sourceVertices = part.vertices, originalFaceCount = sourceFaces.length;
  const vertices = structuredClone(sourceVertices), faces = structuredClone(sourceFaces);
  for (const faceIndex of uniqueIndices) {
    const face = sourceFaces[faceIndex];
    const points = face.map(vertexIndex => sourceVertices[vertexIndex]);
    const normal = axisSnappedNormal(flatNormal(points[0], points[1], points[2]));
    const delta = normal.map(component => component * distance);
    const newIndices = face.map(vertexIndex => {
      vertices.push(sourceVertices[vertexIndex].map((coordinate, axis) => coordinate + delta[axis]));
      return vertices.length - 1;
    });
    faces[faceIndex] = newIndices; // 元の面を新しい位置の面に置き換える（内部に残さない）
    for (let i = 0; i < face.length; i++) {
      const next = (i + 1) % face.length;
      faces.push([face[i], face[next], newIndices[next], newIndices[i]]);
    }
  }
  const next = structuredClone(part);
  next.vertices = vertices;
  next.faces = faces;
  const faceIndexMap = new Map();
  for (let index = 0; index < originalFaceCount; index++) faceIndexMap.set(index, index);
  const { rows, size, pixelsLost } = rebuildMeshTexture(part, next, texelsPerUnit, faceIndexMap);
  if (part.texture) next.texture = { size, rows };
  else delete next.texture;
  return { part: next, pixelsLost };
}
// 面の面積（三角形は1枚、四角形は(0,1,2)+(0,2,3)の2枚の和）。頂点が重なる、または一直線上に
// 並ぶと0になる。座標は常に整数のため、しきい値1e-9は「実質0」の判定として安全に使える。
function faceArea(vertices) {
  const triangles = vertices.length === 3 ? [[0, 1, 2]] : [[0, 1, 2], [0, 2, 3]];
  return triangles.reduce((sum, [a, b, c]) => sum + Math.hypot(...cross3(sub3(vertices[b], vertices[a]), sub3(vertices[c], vertices[a]))) / 2, 0);
}
// 面積0（退化）に潰れた面のインデックスを返す。validateDocからの検査と、UI側の警告表示の両方から使う。
export function degenerateMeshFaceIndices(part) {
  if (part.type !== 'mesh') return [];
  return part.faces.flatMap((face, index) => faceArea(face.map(vertexIndex => part.vertices[vertexIndex])) < 1e-9 ? [index] : []);
}
// 選択した頂点群を同じ量だけ移動する（頂点編集の唯一の変形操作）。頂点は常に整数座標のまま
// （deltaも整数であることを要求する）。移動で面の実寸（footprint）が変わるため、UVアトラスは
// rebuildMeshTexture で作り直す。面のインデックス自体は増減しないため、対応表は恒等写像でよい。
export function moveMeshVertices(part, vertexIndices, delta, texelsPerUnit = DEFAULT_TEXELS_PER_UNIT) {
  if (part.type !== 'mesh') throw new Error(`「${part.name}」はメッシュではないため、頂点を移動できません。`);
  const uniqueIndices = [...new Set(vertexIndices)];
  if (!uniqueIndices.length || !uniqueIndices.every(index => Number.isSafeInteger(index) && index >= 0 && index < part.vertices.length)) {
    throw new Error('移動する頂点の指定が不正です。');
  }
  if (!Array.isArray(delta) || delta.length !== 3 || !delta.every(Number.isSafeInteger)) throw new Error('移動量は整数の[x,y,z]にしてください。');
  if (delta.every(value => value === 0)) return { part: structuredClone(part), pixelsLost: false };
  const vertices = structuredClone(part.vertices);
  for (const index of uniqueIndices) {
    vertices[index] = vertices[index].map((coordinate, axis) => Math.max(-10000, Math.min(10000, coordinate + delta[axis])));
  }
  const next = structuredClone(part);
  next.vertices = vertices;
  const faceIndexMap = new Map(part.faces.map((_, index) => [index, index]));
  const { rows, size, pixelsLost } = rebuildMeshTexture(part, next, texelsPerUnit, faceIndexMap);
  if (part.texture) next.texture = { size, rows };
  else delete next.texture;
  return { part: next, pixelsLost };
}
// しきい値以下の距離にある頂点どうしを1つに統合する（Union-Find）。0（既定）なら完全一致のみ。
// 統合で3頂点未満／面積0に潰れた面は除去する。面の対応関係（faceOrigin）を保った状態で
// rebuildMeshTexture へ渡すため、統合されず残った面のテクスチャ内容は引き継がれる。
export function weldVertices(part, threshold = 0, texelsPerUnit = DEFAULT_TEXELS_PER_UNIT) {
  if (part.type !== 'mesh') throw new Error(`「${part.name}」はメッシュではないため、溶接できません。`);
  if (!Number.isFinite(threshold) || threshold < 0) throw new Error('溶接のしきい値は0以上の数値にしてください。');
  const count = part.vertices.length;
  const parent = Array.from({ length: count }, (_, index) => index);
  const find = index => { while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; } return index; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const thresholdSq = threshold * threshold;
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
    const [ax, ay, az] = part.vertices[i], [bx, by, bz] = part.vertices[j];
    if ((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2 <= thresholdSq) union(i, j);
  }
  const groupIndex = new Map();
  const vertices = [];
  const remap = [];
  for (let i = 0; i < count; i++) {
    const root = find(i);
    if (!groupIndex.has(root)) { groupIndex.set(root, vertices.length); vertices.push(part.vertices[root]); }
    remap.push(groupIndex.get(root));
  }
  const faces = [], faceOrigin = [];
  part.faces.forEach((face, originalIndex) => {
    const remapped = face.map(index => remap[index]);
    const unique = [];
    for (const index of remapped) if (!unique.includes(index)) unique.push(index);
    if (unique.length < 3) return;
    faces.push(unique.length === remapped.length ? remapped : unique);
    faceOrigin.push(originalIndex);
  });
  const next = structuredClone(part);
  next.vertices = vertices;
  next.faces = faces;
  const degenerate = new Set(degenerateMeshFaceIndices(next));
  let survivingFaces = next.faces, survivingOrigin = faceOrigin;
  if (degenerate.size) {
    survivingFaces = []; survivingOrigin = [];
    next.faces.forEach((face, index) => { if (!degenerate.has(index)) { survivingFaces.push(face); survivingOrigin.push(faceOrigin[index]); } });
    next.faces = survivingFaces;
  }
  const verticesRemoved = count - vertices.length;
  const facesRemoved = part.faces.length - survivingFaces.length;
  if (!verticesRemoved) return { part: structuredClone(part), pixelsLost: false, verticesRemoved: 0, facesRemoved: 0 };
  const faceIndexMap = new Map(survivingOrigin.map((oldIndex, newIndex) => [newIndex, oldIndex]));
  const { rows, size, pixelsLost } = rebuildMeshTexture(part, next, texelsPerUnit, faceIndexMap);
  if (part.texture) next.texture = { size, rows };
  else delete next.texture;
  return { part: next, pixelsLost, verticesRemoved, facesRemoved };
}
// 選択した複数パーツを1つのmeshパーツへまとめる。手順：
// 1. mesh以外は先にconvertPartToMeshで変換する（曲面はテクスチャを引き継げないため、そのパーツぶんは
//    後段でパーツ色による面塗りへフォールバックする）。
// 2. 各パーツのposition/rotationを適用してモデル原点基準のワールド座標へ展開し、1つの頂点・面配列にまとめる。
// 3. 頂点座標を整数に丸める（回転が15度の倍数などで非整数になった場合はshapeRoundedを立てて呼び出し側へ知らせる）。
// 4. 結合後のテクスチャは、まず各面をその面の由来パーツのcolorで塗りつぶし（面ごとに色を保持するフォールバック）、
//    その上から「由来パーツが元からmeshで、実際に着色されていた」場合だけ本物のドット絵を対応する面へ転写する
//    （曲面から変換したばかりのパーツは変換時点でテクスチャが失われているため、自然とフォールバックだけになる）。
// ボーンが混在する場合の確認はUI側（main.js）の責務とし、ここでは常に1つ目のパーツのボーンを採用する。
export function mergeParts(doc, partIds, texelsPerUnit = DEFAULT_TEXELS_PER_UNIT) {
  const uniqueIds = [...new Set(partIds ?? [])];
  if (uniqueIds.length < 2) throw new Error('結合には異なる2つ以上のパーツを指定してください。');
  const parts = uniqueIds.map(id => doc.parts.find(candidate => candidate.id === id));
  if (parts.some(part => !part)) throw new Error('結合対象のパーツが見つかりません。');

  const mergedVertices = [], mergedFaces = [], mergedFaceColors = [];
  const partFaceRanges = [];
  let shapeRounded = false;
  for (const source of parts) {
    const meshPart = source.type === 'mesh' ? source : convertPartToMesh(source, texelsPerUnit).part;
    const matrix = localTransformMatrix(source);
    const startVertex = mergedVertices.length;
    for (const vertex of meshPart.vertices) {
      const world = transformPoint(matrix, vertex);
      const rounded = world.map(Math.round);
      if (!shapeRounded && rounded.some((value, axis) => Math.abs(value - world[axis]) > 1e-6)) shapeRounded = true;
      mergedVertices.push(rounded);
    }
    const startFace = mergedFaces.length;
    for (const face of meshPart.faces) { mergedFaces.push(face.map(index => index + startVertex)); mergedFaceColors.push(source.color); }
    partFaceRanges.push({ source, faceCount: meshPart.faces.length, startFace });
  }

  const dedup = dedupeAndFilterMesh(mergedVertices, mergedFaces);
  let { vertices, faces, faceMap } = dedup;
  const degenerate = new Set(degenerateMeshFaceIndices({ type: 'mesh', vertices, faces }));
  if (degenerate.size) {
    const keptFaces = [], keptMap = [];
    faces.forEach((face, index) => { if (!degenerate.has(index)) { keptFaces.push(face); keptMap.push(faceMap[index]); } });
    faces = keptFaces; faceMap = keptMap;
  }
  if (faces.length < 4) throw new Error('結合の結果、面がほとんど潰れてしまいました（頂点の丸めが原因の可能性があります）。');
  faces = autoOrientFaces(vertices, faces);

  const first = parts[0];
  const next = cloneDoc(doc);
  const mergedPart = {
    id: nextPartId(next),
    name: uniquePartName(next, `${first.name}ほか`),
    type: 'mesh',
    position: [0, 0, 0], rotation: [0, 0, 0],
    vertices, faces,
    color: first.color,
    bone: first.bone,
  };
  const layout = meshFaceLayout(mergedPart, texelsPerUnit);
  const [width, height] = layout.size;
  const grid = Array.from({ length: height }, () => Array(width).fill('.'));
  const palette = [...next.palette];
  // まず面ごとに由来パーツの色で塗る（そのパーツ色が結合後パーツの基準色と同じなら、'.'のパーツ色
  // フォールバックに任せて塗らずに済ませる＝単色パーツどうしの結合ではパレットを消費しない）。
  faces.forEach((face, index) => {
    const color = mergedFaceColors[faceMap[index]];
    if (color === mergedPart.color) return;
    let charIndex = palette.indexOf(color);
    if (charIndex < 0) { palette.push(color); charIndex = palette.length - 1; }
    const [fx, fy, fw, fh] = layout.faces[index];
    for (let y = fy; y < fy + fh; y++) for (let x = fx; x < fx + fw; x++) grid[y][x] = PALETTE_CHARS[charIndex];
  });
  // 続いて、元からmeshで実際に着色されていたパーツについては、対応する面へ本物のドット絵を上書き転写する。
  let textureTransferred = false, textureSkipped = false;
  for (const { source, faceCount, startFace } of partFaceRanges) {
    if (source.type !== 'mesh' || !source.texture) continue;
    const sourceLayout = meshFaceLayout(source, texelsPerUnit);
    for (let localFace = 0; localFace < faceCount; localFace++) {
      const oldGlobalIndex = startFace + localFace;
      const newIndex = faceMap.indexOf(oldGlobalIndex);
      if (newIndex < 0) { textureSkipped = true; continue; }
      const sourceRegion = sourceLayout.faces[localFace], targetRegion = layout.faces[newIndex];
      if (!sourceRegion || !targetRegion) continue;
      const [sx, sy, sw, sh] = sourceRegion, [tx, ty, tw, th] = targetRegion;
      const copyWidth = Math.min(sw, tw), copyHeight = Math.min(sh, th);
      for (let y = 0; y < copyHeight; y++) for (let x = 0; x < copyWidth; x++) {
        const character = source.texture.rows[sy + y][sx + x];
        if (character !== '.') { grid[ty + y][tx + x] = character; textureTransferred = true; }
      }
      if (sw > copyWidth || sh > copyHeight) textureSkipped = true;
    }
  }
  mergedPart.texture = { size: [width, height], rows: grid.map(row => row.join('')) };
  next.palette = palette;
  next.parts = next.parts.filter(part => !uniqueIds.includes(part.id));
  next.parts.push(mergedPart);
  return { doc: next, mergedPartId: mergedPart.id, shapeRounded, textureTransferred, textureSkipped, paletteChanged: palette.length !== doc.palette.length };
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
// bones・partsどちらも{position:[x,y,z], rotation:[度,度,度]}の形を持つため共用できる
// （partsのrotationは常に0〜359度の整数だが、mergePartsの結合計算でも同じXYZ Eulerが必要なため公開する）。
export const localTransformMatrix = target => {
  const [x, y, z] = target.rotation.map(value => value * Math.PI / 180);
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  return [
    cz * cy, sz * cy, -sy, 0,
    cz * sy * sx - sz * cx, sz * sy * sx + cz * cx, cy * sx, 0,
    cz * sy * cx + sz * sx, sz * sy * cx - cz * sx, cy * cx, 0,
    target.position[0], target.position[1], target.position[2], 1,
  ];
};
// 列優先4x4行列を1点へ適用する（mergePartsのワールド座標展開に使う）。
export function transformPoint(matrix, point) {
  const [x, y, z] = point;
  return [0, 1, 2].map(row => matrix[row] * x + matrix[4 + row] * y + matrix[8 + row] * z + matrix[12 + row]);
}
export function calculateBoneWorldTransforms(doc) {
  const byId = new Map(doc.bones.map(bone => [bone.id, bone])), result = new Map();
  const calculate = bone => {
    if (result.has(bone.id)) return result.get(bone.id);
    const matrix = bone.parent === null ? localTransformMatrix(bone) : multiplyMatrix4(calculate(byId.get(bone.parent)).matrix, localTransformMatrix(bone));
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
// 人型サンプル。以前は「回転しても関節が抜けない」ことを、腕・脚を胴へ深く差し込むこと
// （胴を縦貫通するほど）だけで担保していたため、静止姿勢のプロポーションが破綻していた
// （腕が胴を縦に貫通し肩より上（首の高さ）まで飛び出す、脚が胴に3グリッドも食い込む等）。
// その後、関節に球（スフィア）を追加したが、深い差し込みをやめずに球だけ足したため、
// 差し込みと球が二重に効いて過剰な貫通になっていた。
// さらにその後の修正では「胴に食い込む量」をY方向の重なりだけで検算しており、X方向の
// 重なりを見落としていた。そのため腕は静止姿勢のY範囲（腕の全高）にわたってX方向へ
// 1グリッド重なった状態になっており、腕が胴の側面に半分めり込んで見える不具合が残っていた
// （検算方法の詳細と修正経緯はdocs/開発ログ.md参照）。
// 今回、方針を「差し込みは1グリッド程度の浅いものにとどめ、隙間を埋める役目は関節の球に
// 一本化する」よう整理し、さらに腕については差し込みそのものをやめてX方向の重なりを0に
// した。具体的には：
// 1. 腕は肩ボーンの位置より上に出ない（肩から下にだけ伸びる）。腕の中心Xは肩ボーン（＝胴
//    側面のX、±2）から腕の半幅（1グリッド）ぶん外側（±3）に置き、腕の内側の面がちょうど
//    胴の側面（x=±2）に接するようにする（X方向の重なりは0）。
// 2. 脚は股関節ボーンの位置からY方向に1グリッドだけ胴へ食い込ませる（それ以上は入れない）。
//    脚は胴の下端に付くため、X方向に胴へ1グリッド重なっていても（Y方向の重なりも同じく
//    1グリッドの角の部分に限られ、腕のように全高にわたって重ならないため）不自然に見えない。
// 3. 肩・股関節・首の3関節には、そのボーン自身の位置を中心にした球を置く。球は自分自身の
//    回転中心を中心に置かれているため、そのボーンがどれだけ回転しても見た目（球の位置・形）が
//    変わらず、回転で開く隙間を埋め続けられる（ローポリのゲームキャラでよく使われる手法）。
//    半径は「回転後もパーツ側の最近接点が球の中心から半径以内にとどまる」よう数値計算で決めてある。
//    肩の球は胴の側面（腕の付け根）にちょうど置かれるため、胴と腕の両方に半径1グリッドずつ
//    またがり、腕を胴から離しても生じるX方向の隙間を埋める。
// 4. 頭身は4.5（全高18÷頭の高さ4）。頭と胴はY範囲を重ねず、隙間は首の球で埋める。
// 検算はdocs/開発ログ.mdとtests/model-texture.mjsを参照。
export function createSampleDoc() {
  const doc = {
    version: 1, name: 'untitled', grid: 1, texelsPerUnit: DEFAULT_TEXELS_PER_UNIT, palette: [...DEFAULT_PALETTE], parts: [],
    bones: [
      // 腰＝胴の回転中心。胴の内部（下端寄り）に置くことで、胴が前傾しても回転中心が
      // 常に胴の内部にとどまり、股関節・脚との接続が切れない（内接半径2グリッドの余裕）。
      { id: 'b1', name: '腰', parent: null, position: [0, 9, 0], rotation: [0, 0, 0] },
      { id: 'b2', name: '胴', parent: 'b1', position: [0, 0, 0], rotation: [0, 0, 0] },
      // 頭ボーンの回転中心は「頭自身の中心」ではなく「首の付け根（胴の上端）」に置く。
      // これにより頭がどんな角度に回転しても、この回転中心に置いた首の球（後述）が
      // 見た目を変えずに首の隙間を埋め続けられる。
      { id: 'b3', name: '頭', parent: 'b2', position: [0, 4, 0], rotation: [0, 0, 0] },
      // 肩ボーンは胴の側面（x=±2）かつ胴の上端（y=13）にちょうど置く。腕の上端をこの高さへ
      // 合わせることで、腕が肩から生えているように見える（肩より上には出ない）。
      { id: 'b4', name: '左腕', parent: 'b2', position: [-2, 4, 0], rotation: [0, 0, 0] },
      { id: 'b5', name: '右腕', parent: 'b2', position: [2, 4, 0], rotation: [0, 0, 0] },
      // 股関節ボーンは胴の真下（x=∓1、左右の脚の間）かつ胴の下端に置く。脚を胴の側面（x=±2）
      // より内側に収めることで、腕（x=∓2..∓4）と脚が立体として交差しなくなる。
      { id: 'b6', name: '左脚', parent: 'b1', position: [-1, -2, 0], rotation: [0, 0, 0] },
      { id: 'b7', name: '右脚', parent: 'b1', position: [1, -2, 0], rotation: [0, 0, 0] },
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
    // 頭：胴の上端(y=13)より2上に隙間(1グリッド)を空けて置く。隙間は首の球で埋める。
    { name: '頭', type: 'box', position: [0, 16, 0], size: [4, 4, 4], color: '#e0a070', bone: 'b3' },
    // 首：頭ボーンの回転中心（胴の上端、首の付け根）にちょうど置いた半径1の球。
    // 頭がどんな角度に回転しても回転中心の位置・形は変わらないため、胴の上端と頭の下端の
    // 間にできる隙間を角度によらず埋め続けられる（肩・股関節と同じ考え方）。
    // sizeは半径どおり[2,2,2]を明示し（他形状同様、他パーツとの交差検算に使う近似バウンディング
    // ボックスを実際の球に合わせる）、頭・肩など無関係なパーツとの見かけの交差誤検出を防ぐ。
    { name: '首', type: 'sphere', position: [0, 13, 0], radius: 1, segments: 8, size: [2, 2, 2], color: '#e0a070', bone: 'b3' },
    // 胴は幅4×奥行4×高さ6（y=7..13）。頭とはY範囲が重ならない。腕はX方向に重ならず
    // （隙間は肩の球で埋める）、脚は胴の真下（x=-2..2の内側）に収めてあるため腕とは
    // 立体として交差しない（詳細は各パーツのコメントとtests/model-texture.mjsの総当たり
    // 交差検査を参照）。
    { name: '胴', type: 'box', position: [0, 10, 0], size: [4, 6, 4], color: '#689caa', bone: 'b2' },
    // 肩の球：肩ボーン（胴の側面・上端、x=∓2, y=13）にちょうど置く。腕の中心Xとは1グリッド
    // ずれているため、球は胴・腕の両方に半径1グリッドずつまたがり、腕を胴から離したことで
    // できるX方向の隙間を埋める（検算はtests/model-texture.mjsとdocs/開発ログ.md参照）。
    { name: '左肩', type: 'sphere', position: [-2, 13, 0], radius: 1, segments: 8, size: [2, 2, 2], color: '#e0a070', bone: 'b4' },
    // 腕：上端(y=13)は肩ボーン(y=13)とちょうど同じ高さ＝肩から生えて見え、かつ肩より上に
    // 出ない。中心Xは肩ボーン（x=∓2）より腕の半幅（1グリッド）だけ外側（x=∓3）に置き、
    // 腕の内側の面をちょうど胴の側面（x=±2）に接するようにしてある（X方向の重なりは0）。
    { name: '左腕', type: 'box', position: [-3, 10, 0], size: [2, 6, 2], color: '#e0a070', bone: 'b4' },
    { name: '右肩', type: 'sphere', position: [2, 13, 0], radius: 1, segments: 8, size: [2, 2, 2], color: '#e0a070', bone: 'b5' },
    { name: '右腕', type: 'box', position: [3, 10, 0], size: [2, 6, 2], color: '#e0a070', bone: 'b5' },
    // 股関節の球：股関節ボーン（胴の真下・下端、x=∓1, y=7）にちょうど置く。
    { name: '左股関節', type: 'sphere', position: [-1, 7, 0], radius: 1, segments: 8, size: [2, 2, 2], color: '#646f8c', bone: 'b6' },
    // 脚：胴の側面（x=±2）より内側（x=-2..0／0..2）に収め、左右の脚は中央(x=0)で接する
    // だけで重ならない。上端(y=8)は股関節ボーン(y=7)より1上＝胴へのY方向の食い込みは
    // 1グリッドのみ。下端(y=0)を地面に接地させ、長さは腕よりも長くしてある。
    { name: '左脚', type: 'box', position: [-1, 4, 0], size: [2, 8, 2], color: '#646f8c', bone: 'b6' },
    { name: '右股関節', type: 'sphere', position: [1, 7, 0], radius: 1, segments: 8, size: [2, 2, 2], color: '#646f8c', bone: 'b7' },
    { name: '右脚', type: 'box', position: [1, 4, 0], size: [2, 8, 2], color: '#646f8c', bone: 'b7' },
  ];
  for (const sample of samples) {
    const { name, type, ...properties } = sample;
    const part = { ...createPart(doc, type), name, ...properties };
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
