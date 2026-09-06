// ModelDoc だけを永続化し、描画用オブジェクトは含めない。
export const cloneDoc = (doc) => structuredClone(doc);
export const DEFAULT_TEXELS_PER_UNIT = 4;
export const DEFAULT_PALETTE = ['#e0a070', '#e8ce9e', '#c96c64', '#689caa', '#646f8c', '#849b69', '#b692bb', '#ece5d8'];
export const PALETTE_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
const integer = (value, min = -10000, max = 10000) => Number.isSafeInteger(value) && value >= min && value <= max;
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
  const diameter = part.radius * 2 * texelsPerUnit;
  const circumference = Math.max(1, Math.ceil(2 * Math.PI * part.radius * texelsPerUnit));
  const sideHeight = part.height * texelsPerUnit;
  return {
    size: [Math.max(circumference, diameter * 2), diameter + sideHeight],
    faces: {
      up: [0, 0, diameter, diameter], down: [diameter, 0, diameter, diameter],
      side: [0, diameter, circumference, sideHeight],
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
  return doc;
}
export function validateDoc(doc) {
  if (!doc || doc.version !== 1 || typeof doc.name !== 'string' || !doc.name.trim() || doc.name.length > 100 || !integer(doc.grid, 1) || !integer(doc.texelsPerUnit, 1, 64) || !Array.isArray(doc.palette) || !doc.palette.length || doc.palette.length > 36 || !doc.palette.every(color => /^#[0-9a-f]{6}$/i.test(color)) || !Array.isArray(doc.parts) || doc.parts.length > 1000) throw new Error('対応していないModelDocです。version・名前・グリッド・テクスチャ設定・パーツ数を確認してください。');
  const ids = new Set();
  for (const part of doc.parts) {
    if (!part || typeof part.id !== 'string' || !part.id || part.id.length > 100 || ids.has(part.id)) throw new Error('パーツIDが空か重複しています。');
    ids.add(part.id);
    if (typeof part.name !== 'string' || !part.name.trim() || part.name.length > 100 || !['box', 'cylinder'].includes(part.type)) throw new Error('パーツの名前または種類が不正です。');
    for (const key of ['position', 'size', 'rotation']) {
      if (!Array.isArray(part[key]) || part[key].length !== 3 || !part[key].every(v => integer(v, key === 'size' ? 1 : -10000))) throw new Error('座標・回転は−10000〜10000の整数、サイズは1〜10000の整数にしてください。');
    }
    if (!integer(part.radius, 1) || !integer(part.height, 1) || !integer(part.segments, 3, 64) || !/^#[0-9a-f]{6}$/i.test(part.color)) throw new Error('半径・高さ・分割数・色が不正です（分割数は3〜64）。');
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
export function createPart(doc, type) {
  if (!['box', 'cylinder'].includes(type)) throw new Error('未対応のパーツです。');
  let number = 1;
  while (doc.parts.some(p => p.id === `p${number}`)) number++;
  const part = { id: `p${number}`, name: `${type === 'box' ? '箱' : '円柱'} ${number}`, type, position: [0, 2, 0], size: [2, 4, 2], radius: 2, height: 4, segments: 8, rotation: [0, 0, 0], color: '#e0a070' };
  part.texture = createBlankTexture(part, doc.texelsPerUnit ?? DEFAULT_TEXELS_PER_UNIT);
  return part;
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
  return { ...structuredClone(source), id: createPart(doc, source.type).id, name: uniquePartName(doc, source.name) };
}
export function mirrorPart(doc, source) {
  const swapped = mirroredName(source.name);
  const copy = duplicatePart(doc, source);
  copy.name = uniquePartName(doc, swapped.matched ? swapped.name : source.name);
  copy.position[0] = -copy.position[0];
  copy.rotation[1] = ((-copy.rotation[1] % 360) + 360) % 360;
  copy.rotation[2] = ((-copy.rotation[2] % 360) + 360) % 360;
  return copy;
}
export function createSampleDoc() {
  const doc = { version: 1, name: 'untitled', grid: 1, texelsPerUnit: DEFAULT_TEXELS_PER_UNIT, palette: [...DEFAULT_PALETTE], parts: [] };
  const samples = [
    ['頭', [0, 12, 0], [4, 4, 4], '#e0a070'],
    ['胴', [0, 7, 0], [4, 6, 2], '#689caa'],
    ['左腕', [-4, 7, 0], [2, 6, 2], '#e0a070'],
    ['右腕', [4, 7, 0], [2, 6, 2], '#e0a070'],
    ['左脚', [-2, 2, 0], [2, 4, 2], '#646f8c'],
    ['右脚', [2, 2, 0], [2, 4, 2], '#646f8c'],
  ];
  for (const [name, position, size, color] of samples) {
    const part = { ...createPart(doc, 'box'), name, position, size, color };
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
    parts: [],
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
    parts: [],
  };
  const samples = [
    { name: '本体', type: 'cylinder', position: [0, 4, 0], radius: 3, height: 6, segments: 10, color: porcelain },
    { name: '蓋', type: 'cylinder', position: [0, 7, 0], radius: 2, height: 1, segments: 10, color: accent },
    { name: 'つまみ', type: 'cylinder', position: [0, 8, 0], radius: 1, height: 2, segments: 8, color: accent },
    { name: '注ぎ口（根元）', type: 'box', position: [3, 4, 0], size: [2, 3, 3], rotation: [0, 0, 15], color: porcelain },
    { name: '注ぎ口（中間）', type: 'box', position: [4, 5, 0], size: [2, 2, 2], rotation: [0, 0, 30], color: porcelain },
    { name: '注ぎ口（先端）', type: 'box', position: [5, 6, 0], size: [2, 1, 1], rotation: [0, 0, 45], color: porcelain },
    { name: '取っ手（上）', type: 'box', position: [-4, 6, 0], size: [3, 1, 2], rotation: [0, 0, -30], color: porcelain },
    { name: '取っ手（外）', type: 'box', position: [-5, 4, 0], size: [1, 5, 2], color: porcelain },
    { name: '取っ手（下）', type: 'box', position: [-4, 2, 0], size: [3, 1, 2], rotation: [0, 0, 30], color: porcelain },
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
