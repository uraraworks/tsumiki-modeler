// ModelDoc から静的メッシュの glTF 2.0 バイナリ（.glb）を組み立てる。
// DOM・Canvas・GLTFExporter に依存しない（ブラウザでも Node でも同じコードで動き、テストしやすい）。
// 形状生成だけは Three.js の BufferGeometry（geometry.js）を使い、描画と書き出しで形がずれないようにする。
//
// 方針：
// - パーツ1つ＝メッシュ1つ＝ノード1つ。ノード名・メッシュ名はパーツ名。変換（位置・回転）は頂点に焼き込み、
//   ノード自体は恒等変換にする（ワールド座標で出す）。
// - 単色パーツ：マテリアルは白、パーツ色を COLOR_0（頂点カラー、リニア値）で出す。
// - テクスチャ付きパーツ（ドットが1つでも描かれていて colorMode が 'solid' でない）：
//   '.' をパーツ色で塗ったPNGを埋め込み、COLOR_0 は白にする（glTF は 色=ベース色テクスチャ×COLOR_0 のため、
//   二重に掛からないようにする）。
// - ボーン・アニメーションは出さない（静的メッシュ）。将来の設計メモは docs/開発ログ.md を参照。
import * as THREE from 'three';
import { createPartGeometry } from './geometry.js';
import { applyAtlasUV } from './texture.js';
import { PALETTE_CHARS, hasPaintedTexture, isSolidPart, localTransformMatrix, transformPoint } from './model.js';

const FLOAT = 5126, UNSIGNED_SHORT = 5123, UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;

// --- 色 ---
const hexToRgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
const srgbToLinear = value => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
export const hexToLinearRgb = hex => hexToRgb(hex).map(srgbToLinear);

// --- PNG（無圧縮 deflate の stored ブロック。テクスチャは小さいので圧縮しない） ---
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function adler32(bytes) {
  let a = 1, b = 0;
  for (const byte of bytes) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}
function zlibStored(raw) {
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  const view = new DataView(out.buffer);
  out[0] = 0x78; out[1] = 0x01;
  let offset = 2;
  for (let block = 0; block < blocks; block++) {
    const start = block * 65535, length = Math.min(65535, raw.length - start);
    out[offset++] = block === blocks - 1 ? 1 : 0;
    view.setUint16(offset, length, true); view.setUint16(offset + 2, ~length & 0xffff, true); offset += 4;
    out.set(raw.subarray(start, start + length), offset); offset += length;
  }
  view.setUint32(offset, adler32(raw), false);
  return out;
}
export function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1); // 先頭1バイトはフィルタ0
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
    view.setUint32(0, data.length, false);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
    return out;
  };
  const header = new Uint8Array(13), headerView = new DataView(header.buffer);
  headerView.setUint32(0, width, false); headerView.setUint32(4, height, false);
  header[8] = 8; header[9] = 6; // 8bit・RGBA
  const parts = [Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk('IHDR', header), chunk('IDAT', zlibStored(raw)), chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((sum, bytes) => sum + bytes.length, 0));
  let offset = 0;
  for (const bytes of parts) { png.set(bytes, offset); offset += bytes.length; }
  return png;
}
// パーツのテクスチャを RGBA に展開する（'.' はパーツ色）。
function textureRgba(part, palette) {
  const [width, height] = part.texture.size;
  const fallback = hexToRgb(part.color);
  const colors = [...palette].map(hexToRgb);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const character = part.texture.rows[y][x];
    const rgb = character === '.' ? fallback : colors[PALETTE_CHARS.indexOf(character)];
    rgba.set([...rgb, 255], (y * width + x) * 4);
  }
  return { width, height, rgba };
}

// --- バイナリ組み立て ---
class BinaryBuilder {
  constructor() { this.chunks = []; this.length = 0; this.bufferViews = []; }
  // 4バイト境界に揃えて追加し、bufferView の番号を返す。
  add(bytes, target) {
    const padding = (4 - (this.length % 4)) % 4;
    if (padding) { this.chunks.push(new Uint8Array(padding)); this.length += padding; }
    const view = { buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength };
    if (target) view.target = target;
    this.chunks.push(bytes); this.length += bytes.byteLength;
    this.bufferViews.push(view);
    return this.bufferViews.length - 1;
  }
  finish() {
    const padding = (4 - (this.length % 4)) % 4;
    const out = new Uint8Array(this.length + padding);
    let offset = 0;
    for (const chunk of this.chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
    return out;
  }
}
const asBytes = typed => new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);

// options:
//   metersPerUnit … 1単位が何メートルか。未指定は doc.unitCm/100、それも無ければ 1（換算なし）。
//   vertexColors  … false なら COLOR_0 を出さず、マテリアルの baseColorFactor にパーツ色を入れる（既定 true）。
export function buildGlb(doc, options = {}) {
  const metersPerUnit = options.metersPerUnit ?? (doc.unitCm !== undefined ? doc.unitCm / 100 : 1);
  if (!Number.isFinite(metersPerUnit) || metersPerUnit <= 0) throw new Error('metersPerUnitは正の数値にしてください。');
  if (!doc.parts.length) throw new Error('書き出すパーツがありません。');
  const useVertexColors = options.vertexColors !== false;
  const binary = new BinaryBuilder();
  const gltf = {
    asset: { version: '2.0', generator: 'Tsumiki Modeler' },
    scene: 0, scenes: [{ name: doc.name, nodes: [], extras: { source: 'tsumiki-modeler', unitCm: doc.unitCm ?? null, metersPerUnit } }],
    nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [{ byteLength: 0 }],
  };
  const materialIndexByKey = new Map();
  const getMaterial = (key, create) => {
    if (!materialIndexByKey.has(key)) { gltf.materials.push(create()); materialIndexByKey.set(key, gltf.materials.length - 1); }
    return materialIndexByKey.get(key);
  };
  const addAccessor = (typed, type, componentType, target, extra = {}) => {
    const bufferView = binary.add(asBytes(typed), target);
    const componentCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    gltf.accessors.push({ bufferView, componentType, count: typed.length / componentCount, type, ...extra });
    return gltf.accessors.length - 1;
  };
  const stats = { parts: 0, vertices: 0, triangles: 0, textures: 0 };
  const boundsMin = [Infinity, Infinity, Infinity], boundsMax = [-Infinity, -Infinity, -Infinity];

  for (const part of doc.parts) {
    const geometry = createPartGeometry(part, THREE);
    let textured = !isSolidPart(part) && hasPaintedTexture(part);
    if (textured && applyAtlasUV(geometry, part, doc.texelsPerUnit) === null) textured = false;
    const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
    const count = position.count;
    const matrix = localTransformMatrix(part);
    const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const world = transformPoint(matrix, [position.getX(i), position.getY(i), position.getZ(i)]);
      // 法線は回転のみ適用（平行移動を除く）。パーツに非一様スケールは無い。
      const origin = transformPoint(matrix, [0, 0, 0]);
      const rotated = transformPoint(matrix, [normal.getX(i), normal.getY(i), normal.getZ(i)]).map((value, axis) => value - origin[axis]);
      const length = Math.hypot(...rotated) || 1;
      for (let axis = 0; axis < 3; axis++) {
        const scaled = world[axis] * metersPerUnit;
        positions[i * 3 + axis] = scaled;
        boundsMin[axis] = Math.min(boundsMin[axis], scaled); boundsMax[axis] = Math.max(boundsMax[axis], scaled);
        normals[i * 3 + axis] = rotated[axis] / length;
      }
    }
    const partMin = [Infinity, Infinity, Infinity], partMax = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < count; i++) for (let axis = 0; axis < 3; axis++) {
      partMin[axis] = Math.min(partMin[axis], positions[i * 3 + axis]); partMax[axis] = Math.max(partMax[axis], positions[i * 3 + axis]);
    }
    const attributes = {
      POSITION: addAccessor(positions, 'VEC3', FLOAT, ARRAY_BUFFER, { min: partMin, max: partMax }),
      NORMAL: addAccessor(normals, 'VEC3', FLOAT, ARRAY_BUFFER),
    };
    if (textured) {
      const uvs = new Float32Array(count * 2);
      for (let i = 0; i < count; i++) { uvs[i * 2] = uv.getX(i); uvs[i * 2 + 1] = 1 - uv.getY(i); } // glTF は v が下向き
      attributes.TEXCOORD_0 = addAccessor(uvs, 'VEC2', FLOAT, ARRAY_BUFFER);
    }
    let material;
    if (textured) {
      const { width, height, rgba } = textureRgba(part, doc.palette);
      const imageView = binary.add(encodePng(width, height, rgba));
      (gltf.images ??= []).push({ bufferView: imageView, mimeType: 'image/png', name: `${part.name}_texture` });
      (gltf.samplers ??= [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }]);
      (gltf.textures ??= []).push({ sampler: 0, source: gltf.images.length - 1 });
      const textureIndex = gltf.textures.length - 1;
      stats.textures++;
      material = getMaterial(`tex:${part.id}`, () => ({
        name: `${part.name}_texture`,
        pbrMetallicRoughness: { baseColorTexture: { index: textureIndex }, baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
      }));
    } else {
      const linear = hexToLinearRgb(part.color);
      material = getMaterial(`solid:${part.color.toLowerCase()}:${useVertexColors}`, () => ({
        name: `solid_${part.color.slice(1).toLowerCase()}`,
        pbrMetallicRoughness: { baseColorFactor: useVertexColors ? [1, 1, 1, 1] : [...linear, 1], metallicFactor: 0, roughnessFactor: 1 },
      }));
    }
    if (useVertexColors) {
      const rgb = textured ? [1, 1, 1] : hexToLinearRgb(part.color);
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) colors.set(rgb, i * 3);
      attributes.COLOR_0 = addAccessor(colors, 'VEC3', FLOAT, ARRAY_BUFFER);
    }
    const sourceIndex = geometry.index;
    const indexCount = sourceIndex ? sourceIndex.count : count;
    const indices = count < 65535 ? new Uint16Array(indexCount) : new Uint32Array(indexCount);
    for (let i = 0; i < indexCount; i++) indices[i] = sourceIndex ? sourceIndex.getX(i) : i;
    const indexAccessor = addAccessor(indices, 'SCALAR', indices instanceof Uint16Array ? UNSIGNED_SHORT : UNSIGNED_INT, ELEMENT_ARRAY_BUFFER);
    gltf.meshes.push({ name: part.name, primitives: [{ attributes, indices: indexAccessor, material, mode: 4 }] });
    gltf.nodes.push({ name: part.name, mesh: gltf.meshes.length - 1, extras: { partId: part.id, partType: part.type } });
    gltf.scenes[0].nodes.push(gltf.nodes.length - 1);
    stats.parts++; stats.vertices += count; stats.triangles += indexCount / 3;
    geometry.dispose();
  }

  const bin = binary.finish();
  gltf.bufferViews = binary.bufferViews;
  gltf.buffers[0].byteLength = bin.byteLength;
  for (const key of ['images', 'textures', 'samplers']) if (gltf[key] && !gltf[key].length) delete gltf[key];
  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPadded = new Uint8Array(jsonBytes.length + (4 - (jsonBytes.length % 4)) % 4).fill(0x20);
  jsonPadded.set(jsonBytes);
  const total = 12 + 8 + jsonPadded.length + 8 + bin.length;
  const glb = new Uint8Array(total), view = new DataView(glb.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true); // 'glTF' version 2
  view.setUint32(12, jsonPadded.length, true); view.setUint32(16, 0x4e4f534a, true); glb.set(jsonPadded, 20); // 'JSON'
  const binOffset = 20 + jsonPadded.length;
  view.setUint32(binOffset, bin.length, true); view.setUint32(binOffset + 4, 0x004e4942, true); glb.set(bin, binOffset + 8); // 'BIN\0'
  const hasBounds = Number.isFinite(boundsMin[0]);
  return {
    glb,
    stats: {
      ...stats, byteLength: total, metersPerUnit, vertexColors: useVertexColors,
      boundsMeters: hasBounds ? { min: boundsMin, max: boundsMax, size: boundsMax.map((value, axis) => value - boundsMin[axis]) } : null,
    },
  };
}

export function glbFileName(doc) {
  return `${doc.name.replace(/[\\/:*?"<>|]/g, '_')}.glb`;
}
