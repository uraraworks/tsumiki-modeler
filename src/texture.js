import * as THREE from 'three';
import { PALETTE_CHARS, createPartTexturePixels, textureLayout } from './model.js';
import { atlasPixelForVertex } from './uv-layout.js';

const atlasUv = (x, y, width, height) => [x / width, 1 - y / height];

export function applyAtlasUV(geometry, part, texelsPerUnit) {
  const layout = textureLayout(part, texelsPerUnit);
  const [atlasWidth, atlasHeight] = layout.size;
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const oldUv = geometry.getAttribute('uv');
  const values = new Float32Array(position.count * 2);
  const set = (index, region, x, y) => {
    const uv = atlasUv(region[0] + x, region[1] + y, atlasWidth, atlasHeight);
    values[index * 2] = uv[0]; values[index * 2 + 1] = uv[1];
  };
  for (let index = 0; index < position.count; index++) {
    const mapped = atlasPixelForVertex(
      part, layout,
      [position.getX(index), position.getY(index), position.getZ(index)],
      [normal.getX(index), normal.getY(index), normal.getZ(index)],
      [oldUv.getX(index), oldUv.getY(index)], texelsPerUnit,
    );
    // 未対応形状や不完全なレイアウトは既定UVを維持し、呼び出し側でテクスチャ無しにする。
    if (!mapped) return null;
    const [face, x, y] = mapped;
    set(index, layout.faces[face], x, y);
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(values, 2));
  geometry.getAttribute('uv').needsUpdate = true;
  return layout;
}

export function createPartCanvasTexture(part, palette) {
  const generated = createPartTexturePixels(part, palette);
  if (!generated) return null;
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = generated.size;
  const context = canvas.getContext('2d');
  context.fillStyle = part.color; context.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const color = generated.pixels[y * canvas.width + x];
    if (!color) continue;
    context.fillStyle = color;
    context.fillRect(x, y, 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export function updatePartCanvasTexturePixel(texture, part, palette, x, y, character) {
  const canvas = texture?.image;
  if (!canvas || x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const context = canvas.getContext('2d');
  context.fillStyle = character === '.' ? part.color : palette[PALETTE_CHARS.indexOf(character)];
  context.fillRect(x, y, 1, 1);
  texture.needsUpdate = true;
}

export function textureSignature(part, palette) {
  return part.texture ? JSON.stringify([part.texture, part.color, palette]) : null;
}
