// glTF(.glb) 書き出しのテスト。書き出した glb を three の GLTFLoader で読み戻して、
// 頂点数・ノード名・色・スケール・テクスチャが元のModelDocと一致することを確認する。
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { applyCommand } from '../src/commands.js';
import { createNewDoc, createSampleDoc, hasPaintedTexture, isSolidPart, modelExtent } from '../src/model.js';
import { createPartGeometry } from '../src/geometry.js';

let THREE, GLTFLoader, buildGlb, encodePng, hexToLinearRgb;
try {
  THREE = await import('three');
} catch {
  console.log('gltf-export: skipped（`npm install` で three を入れると実行されます）');
  process.exit(0);
}
// GLTFLoader は生成時に createImageBitmap の有無でテクスチャローダーを選ぶ。Node には無いため、
// PNGを自前でデコードして記録するだけの代用品を先に用意する（実際のGPU転送は不要）。
globalThis.self ??= globalThis; // GLTFLoaderがブラウザのselfを参照する
const decodedImages = [];
globalThis.createImageBitmap = async blob => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const width = view.getUint32(16), height = view.getUint32(20);
  const idat = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset), type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (type === 'IDAT') idat.push(bytes.slice(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    assert.equal(raw[y * (stride + 1)], 0, 'PNGのフィルタは0');
    rgba.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  const bitmap = { width, height, rgba, close() {} };
  decodedImages.push(bitmap);
  return bitmap;
};
({ GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'));
({ buildGlb, encodePng, hexToLinearRgb } = await import('../src/gltf-export.js'));

const parseGlb = glb => new Promise((resolve, reject) => {
  const buffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
  new GLTFLoader().parse(buffer, '', resolve, reject);
});
const jsonOf = glb => {
  const view = new DataView(glb.buffer, glb.byteOffset);
  assert.equal(view.getUint32(0, true), 0x46546c67, 'glTFマジック');
  assert.equal(view.getUint32(4, true), 2, 'バージョン2');
  assert.equal(view.getUint32(8, true), glb.byteLength, '全体長が一致');
  const jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a, 'JSONチャンク');
  assert.equal(jsonLength % 4, 0, 'JSONチャンクは4バイト境界');
  return JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLength)));
};
const near = (actual, expected, message, tolerance = 1e-5) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} != ${expected}`);
const linear = hex => { const color = new THREE.Color(hex); return [color.r, color.g, color.b]; };

// --- PNGエンコーダ（無圧縮deflate）単体：自前デコードで往復 ---
{
  const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 255]);
  const png = encodePng(2, 2, rgba);
  assert.deepEqual([...png.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const bitmap = await globalThis.createImageBitmap(new Blob([png]));
  assert.deepEqual([...bitmap.rgba], [...rgba]);
  // 65535バイトを超えるデータ（複数stored）も壊れない
  const big = new Uint8Array(300 * 300 * 4).map((_, index) => index * 7 % 251);
  const bigBitmap = await globalThis.createImageBitmap(new Blob([encodePng(300, 300, big)]));
  assert.deepEqual([...bigBitmap.rgba], [...big]);
}

// --- 単色パーツ中心のドキュメント（1単位＝1cm） ---
let doc = { ...createNewDoc(), name: 'テスト株', unitCm: 1, parts: [] };
const add = part => { doc = applyCommand(doc, { type: 'addPart', part: { colorMode: 'solid', ...part } }); };
add({ name: '茎', type: 'cylinder', radius: 1, radiusTop: 1, radiusBottom: 2, height: 100, segments: 8, position: [0, 50, 0], color: '#5c8f3d' });
add({ name: '実', type: 'sphere', radius: 4, segments: 10, position: [8, 30, 0], color: '#d63a2f' });
add({ name: '葉', type: 'box', size: [12, 1, 8], position: [-9, 60, 2], rotation: [0, 30, 15], color: '#3f7d34' });
add({ name: 'ヘタ（左）', type: 'capsule', radius: 1, height: 3, segments: 6, position: [0, 110, 0], rotation: [10, 20, 30], color: '#2f6b2a' });
doc = applyCommand(doc, { type: 'addPart', part: { name: '箱メッシュ', type: 'box', size: [4, 4, 4], position: [20, 2, 0], colorMode: 'solid', color: '#c9a45c' } });
doc = applyCommand(doc, { type: 'convertToMesh', partId: doc.parts.at(-1).id });
doc = applyCommand(doc, { type: 'setSolidColor', partId: doc.parts.at(-1).id, color: '#c9a45c' });

{
  const { glb, stats } = buildGlb(doc);
  const json = jsonOf(glb);
  assert.equal(json.asset.version, '2.0');
  assert.deepEqual(json.nodes.map(node => node.name), doc.parts.map(part => part.name), 'ノード名＝パーツ名（順序も一致）');
  assert.equal(json.images, undefined, '単色のみならテクスチャを含めない');
  assert.equal(stats.metersPerUnit, 0.01, 'unitCm=1 → 1単位=0.01m');
  const gltf = await parseGlb(glb);
  const meshes = new Map();
  gltf.scene.traverse(object => { if (object.isMesh) meshes.set(object.name, object); });
  assert.deepEqual([...meshes.keys()].sort(), doc.parts.map(part => part.name).sort(), 'GLTFLoaderで読み戻したノード名が一致');
  let totalVertices = 0;
  for (const part of doc.parts) {
    const mesh = meshes.get(part.name);
    const expected = createPartGeometry(part, THREE);
    const geometry = mesh.geometry;
    assert.equal(geometry.getAttribute('position').count, expected.getAttribute('position').count, `${part.name}の頂点数が一致`);
    totalVertices += geometry.getAttribute('position').count;
    // 色：COLOR_0はパーツ色のリニア値
    const color = geometry.getAttribute('color');
    assert.ok(color, `${part.name}はCOLOR_0を持つ`);
    const want = linear(part.color);
    for (let i = 0; i < color.count; i++) for (let channel = 0; channel < 3; channel++) near(color.array[i * 3 + channel], want[channel], `${part.name}のCOLOR_0`);
    assert.equal(geometry.getAttribute('uv'), undefined, '単色パーツにUVは不要');
    // 三角形数
    const triangleCount = (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3;
    const expectedTriangles = (expected.index ? expected.index.count : expected.getAttribute('position').count) / 3;
    assert.equal(triangleCount, expectedTriangles, `${part.name}の三角形数が一致`);
  }
  assert.equal(stats.vertices, totalVertices);
  // スケール：全体の高さ（メートル）= モデルのcm高さ / 100
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const extent = modelExtent(doc);
  // 球・カプセル・円柱の外接は近似（分割数による）なので、高さは軸に平行な茎・カプセルで決まる範囲を許容誤差つきで比較
  near(box.max.y - box.min.y, stats.boundsMeters.size[1], '高さ（m）が統計と一致');
  near(box.min.y, 0, '地面（y=0）から始まる', 1e-6);
  assert.ok(Math.abs((box.max.y - box.min.y) - extent.size[1] * 0.01) < 0.02, '高さはmodelExtentの0.01倍に近い');
  // 位置：葉の中心はワールド位置×0.01
  const leafBox = new THREE.Box3().setFromObject(meshes.get('葉'));
  const leafCenter = leafBox.getCenter(new THREE.Vector3());
  near(leafCenter.x, -0.09, '葉のx（m）', 0.01); near(leafCenter.y, 0.6, '葉のy（m）', 0.01);
  // 法線は単位長
  const normal = meshes.get('実').geometry.getAttribute('normal');
  for (let i = 0; i < normal.count; i++) near(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)), 1, '法線長');
}

// --- スケールオプション：metersPerUnit を明示すると doc.unitCm より優先 / 換算なしは1単位=1 ---
{
  const a = buildGlb(doc, { metersPerUnit: 1 }).stats.boundsMeters.size[1];
  const b = buildGlb(doc).stats.boundsMeters.size[1];
  near(a / b, 100, 'metersPerUnit=1は既定の100倍');
  const noUnit = { ...doc }; delete noUnit.unitCm;
  near(buildGlb(noUnit).stats.boundsMeters.size[1], a, 'unitCm無しは1単位=1m');
  assert.throws(() => buildGlb(doc, { metersPerUnit: 0 }), /metersPerUnit/);
  assert.throws(() => buildGlb({ ...doc, parts: [] }), /パーツがありません/);
}

// --- vertexColors:false ではCOLOR_0を出さず、baseColorFactorへパーツ色（リニア） ---
{
  const { glb } = buildGlb(doc, { vertexColors: false });
  const gltf = await parseGlb(glb);
  gltf.scene.traverse(object => {
    if (!object.isMesh) return;
    assert.equal(object.geometry.getAttribute('color'), undefined);
    const part = doc.parts.find(candidate => candidate.name === object.name);
    const want = linear(part.color);
    const got = [object.material.color.r, object.material.color.g, object.material.color.b];
    got.forEach((value, channel) => near(value, want[channel], `${part.name}のbaseColor`));
  });
}

// --- テクスチャ付きパーツ：PNGが埋め込まれ、'.'はパーツ色、描いたドットはパレット色 ---
{
  let textured = { ...createNewDoc(), name: 'テクスチャ', parts: [] };
  textured = applyCommand(textured, { type: 'addPart', part: { name: '顔', type: 'box', size: [4, 4, 4], color: '#e0a070' } });
  const faceId = textured.parts[0].id;
  textured = applyCommand(textured, { type: 'paintPixels', partId: faceId, pixels: [[0, 0, '2'], [1, 0, '3'], [5, 6, '7']] });
  textured = applyCommand(textured, { type: 'addPart', part: { name: '空テクスチャ', type: 'box', size: [2, 2, 2], position: [10, 1, 0], color: '#112233' } }); // 描いていない → 単色扱い
  textured = applyCommand(textured, { type: 'addPart', part: { name: '単色に戻した', type: 'box', size: [2, 2, 2], position: [14, 1, 0], color: '#445566' } });
  textured = applyCommand(textured, { type: 'paintPixels', partId: textured.parts[2].id, pixels: [[0, 0, '1']] });
  textured = applyCommand(textured, { type: 'setColorMode', partId: textured.parts[2].id, mode: 'solid' }); // 描いてあってもsolidなら単色
  assert.equal(hasPaintedTexture(textured.parts[0]), true);
  assert.equal(isSolidPart(textured.parts[2]), true);
  const { glb, stats } = buildGlb(textured);
  const json = jsonOf(glb);
  assert.equal(stats.textures, 1, '描いたテクスチャは1枚だけ');
  assert.equal(json.images.length, 1);
  assert.equal(json.images[0].mimeType, 'image/png');
  assert.equal(json.samplers[0].magFilter, 9728, 'ドット絵なのでNEAREST');
  const gltf = await parseGlb(glb);
  const meshes = new Map();
  gltf.scene.traverse(object => { if (object.isMesh) meshes.set(object.name, object); });
  const face = meshes.get('顔');
  assert.ok(face.material.map, '顔はテクスチャ付き');
  assert.ok(face.geometry.getAttribute('uv'), '顔はUVを持つ');
  assert.equal(face.geometry.getAttribute('uv').count, face.geometry.getAttribute('position').count);
  for (let i = 0; i < face.geometry.getAttribute('uv').count; i++) {
    const u = face.geometry.getAttribute('uv').getX(i), v = face.geometry.getAttribute('uv').getY(i);
    assert.ok(u >= -1e-6 && u <= 1 + 1e-6 && v >= -1e-6 && v <= 1 + 1e-6, 'UVは0〜1');
  }
  for (let i = 0; i < face.geometry.getAttribute('color').count; i++) near(face.geometry.getAttribute('color').getX(i), 1, 'テクスチャ付きのCOLOR_0は白');
  const image = decodedImages.at(-1);
  const part = textured.parts[0];
  assert.deepEqual([image.width, image.height], part.texture.size, 'テクスチャ寸法が一致');
  const pixel = (x, y) => [...image.rgba.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];
  const hexRgb = hex => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16));
  assert.deepEqual(pixel(0, 0), [...hexRgb(textured.palette[2]), 255], '描いたドット（パレット2）');
  assert.deepEqual(pixel(1, 0), [...hexRgb(textured.palette[3]), 255]);
  assert.deepEqual(pixel(5, 6), [...hexRgb(textured.palette[7]), 255]);
  assert.deepEqual(pixel(10, 10), [...hexRgb('#e0a070'), 255], "'.'はパーツ色");
  for (const name of ['空テクスチャ', '単色に戻した']) {
    assert.equal(meshes.get(name).material.map, null, `${name}はテクスチャ無し`);
    assert.ok(meshes.get(name).geometry.getAttribute('color'), `${name}は頂点カラー`);
  }
  assert.deepEqual(json.nodes.map(node => node.name), textured.parts.map(item => item.name));
}

// --- 既存の人型サンプル（ドット絵向け・テクスチャ空・unitCm無し）もそのまま書き出せる ---
{
  const human = createSampleDoc();
  const { glb, stats } = buildGlb(human);
  const gltf = await parseGlb(glb);
  const names = [];
  gltf.scene.traverse(object => { if (object.isMesh) names.push(object.name); });
  assert.deepEqual(names.sort(), human.parts.map(part => part.name).sort());
  assert.equal(stats.textures, 0);
  near(stats.metersPerUnit, 1, '換算なし');
  assert.equal(hexToLinearRgb('#ffffff')[0], 1);
}

console.log('gltf-export: ok');
