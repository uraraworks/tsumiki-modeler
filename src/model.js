// ModelDoc だけを永続化し、描画用オブジェクトは含めない。
export const cloneDoc = (doc) => structuredClone(doc);
const integer = (value, min = -10000, max = 10000) => Number.isSafeInteger(value) && value >= min && value <= max;
export function validateDoc(doc) {
  if (!doc || doc.version !== 1 || typeof doc.name !== 'string' || !doc.name.trim() || doc.name.length > 100 || !integer(doc.grid, 1) || !Array.isArray(doc.parts) || doc.parts.length > 1000) throw new Error('対応していないModelDocです。version・名前・グリッド・パーツ数を確認してください。');
  const ids = new Set();
  for (const part of doc.parts) {
    if (!part || typeof part.id !== 'string' || !part.id || part.id.length > 100 || ids.has(part.id)) throw new Error('パーツIDが空か重複しています。');
    ids.add(part.id);
    if (typeof part.name !== 'string' || !part.name.trim() || part.name.length > 100 || !['box', 'cylinder'].includes(part.type)) throw new Error('パーツの名前または種類が不正です。');
    for (const key of ['position', 'size', 'rotation']) {
      if (!Array.isArray(part[key]) || part[key].length !== 3 || !part[key].every(v => integer(v, key === 'size' ? 1 : -10000))) throw new Error('座標・回転は−10000〜10000の整数、サイズは1〜10000の整数にしてください。');
    }
    if (!integer(part.radius, 1) || !integer(part.height, 1) || !integer(part.segments, 3, 64) || !/^#[0-9a-f]{6}$/i.test(part.color)) throw new Error('半径・高さ・分割数・色が不正です（分割数は3〜64）。');
  }
  return doc;
}
export function createPart(doc, type) {
  if (!['box', 'cylinder'].includes(type)) throw new Error('未対応のパーツです。');
  let number = 1;
  while (doc.parts.some(p => p.id === `p${number}`)) number++;
  return { id: `p${number}`, name: `${type === 'box' ? '箱' : '円柱'} ${number}`, type, position: [0, 2, 0], size: [2, 4, 2], radius: 2, height: 4, segments: 8, rotation: [0, 0, 0], color: '#e0a070' };
}
export function createSampleDoc() {
  const doc = { version: 1, name: 'untitled', grid: 1, parts: [] };
  const samples = [
    ['頭', [0, 12, 0], [4, 4, 4], '#e0a070'],
    ['胴', [0, 7, 0], [4, 6, 2], '#689caa'],
    ['左腕', [-4, 7, 0], [2, 6, 2], '#e0a070'],
    ['右腕', [4, 7, 0], [2, 6, 2], '#e0a070'],
    ['左脚', [-2, 2, 0], [2, 4, 2], '#646f8c'],
    ['右脚', [2, 2, 0], [2, 4, 2], '#646f8c'],
  ];
  for (const [name, position, size, color] of samples) doc.parts.push({ ...createPart(doc, 'box'), name, position, size, color });
  return validateDoc(doc);
}
export const serializeDoc = doc => JSON.stringify(validateDoc(doc), null, 2);
export const deserializeDoc = text => cloneDoc(validateDoc(JSON.parse(text)));
