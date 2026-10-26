// GLB修正モードの画面。ModelDocは使わず、読み込んだGLBのジオメトリとテクスチャ画像を直接編集する。
// 編集ロジックは glb-edit.js（DOM非依存）に置き、ここは表示・入力・Undoの組み立てだけを受け持つ。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { createToonMaterial } from '../materials.js';
import {
  buildPositionGroups, expandToGroups, growSelection, verticesWithinRadius, selectionCenter, moveVertices,
  flattenTarget, flattenVertices, recomputeNormals, EditHistory, paintCircle, stampCircle, sampleColor,
  rgbToHex, hexToRgb, getVertex,
} from './glb-edit.js';

const $ = id => document.getElementById(id);
const host = $('canvas-host'), viewportElement = $('viewport');

// ---- シーン ----
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
host.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#d9e1e8');
const camera = new THREE.PerspectiveCamera(30, 1, 0.001, 1000);
camera.position.set(2, 1.6, 2);
const light = new THREE.DirectionalLight('#ffffff', 0.9);
light.position.set(-1.5, 3, 2);
const ambient = new THREE.AmbientLight('#ffffff', 0.35);
// トゥーンはlight/ambientの値だけを使う（シーンのライトは見ない）。「形だけ」表示を明るくする半球光はLambert専用。
const hemisphere = new THREE.HemisphereLight('#ffffff', '#8a8f96', 0.9);
scene.add(light, ambient, hemisphere);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = false;
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setSize(0.8);
const pivot = new THREE.Object3D();
scene.add(pivot, gizmo.getHelper());

const state = {
  mode: 'select', shading: 'texture', paintTool: 'brush',
  fileName: null, mesh: null, wire: null, allPoints: null, selectedPoints: null,
  positions: null, normals: null, uvs: null, indexArray: null, groups: null,
  selection: [], firstSelected: null,
  canvas: null, context: null, pixels: null, texture: null, materials: null,
  stampSource: null, lastPaintRect: null,
};
const history = new EditHistory(100);

function setStatus(message, isError = false) {
  $('status').textContent = message;
  $('status').classList.toggle('error', isError);
}

function resize() {
  const { clientWidth: width, clientHeight: height } = viewportElement;
  renderer.setSize(width, height);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewportElement);
resize();
renderer.setAnimationLoop(() => renderer.render(scene, camera));

// ---- 読み込み ----
async function loadGlb(buffer, fileName) {
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  gltf.scene.updateMatrixWorld(true);
  const meshes = [];
  gltf.scene.traverse(object => { if (object.isMesh) meshes.push(object); });
  if (!meshes.length) throw new Error('メッシュが見つかりません。');
  const source = meshes[0];
  // ノードの変換を頂点へ焼き込み、以降は「ローカル座標＝ワールド座標」として扱う。
  let geometry = source.geometry.clone();
  geometry.applyMatrix4(source.matrixWorld);
  for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
  if (!geometry.index) geometry.setIndex([...Array(geometry.getAttribute('position').count).keys()]);
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  // 型付き配列を直接書き換えるため、インターリーブなどを解いた素のFloat32Arrayへ揃える。
  for (const name of ['position', 'normal', 'uv']) {
    const attribute = geometry.getAttribute(name);
    if (!attribute) continue;
    const plain = new Float32Array(attribute.count * attribute.itemSize);
    for (let i = 0; i < attribute.count; i++) for (let k = 0; k < attribute.itemSize; k++) plain[i * attribute.itemSize + k] = attribute.getComponent(i, k);
    geometry.setAttribute(name, new THREE.BufferAttribute(plain, attribute.itemSize));
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();

  clearModel();
  state.fileName = fileName;
  state.positions = geometry.getAttribute('position').array;
  state.normals = geometry.getAttribute('normal').array;
  state.uvs = geometry.getAttribute('uv')?.array ?? null;
  state.indexArray = geometry.index.array;
  state.groups = buildPositionGroups(state.positions);
  setupTexture(source.material);

  const clay = new THREE.MeshLambertMaterial({ color: '#d8d2c8', flatShading: true });
  const textured = new THREE.MeshBasicMaterial({ map: state.texture, color: state.texture ? '#ffffff' : (source.material.color ?? '#cccccc') });
  const toon = createToonMaterial(source.material.color ?? '#ffffff', light, ambient, state.texture);
  for (const material of [clay, textured, toon]) Object.assign(material, { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  state.materials = { clay, texture: textured, toon };
  state.mesh = new THREE.Mesh(geometry, state.materials[state.shading]);
  state.wire = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#1d2630', wireframe: true, transparent: true, opacity: 0.25 }));
  state.wire.visible = $('show-wireframe').checked;
  const pointGeometry = new THREE.BufferGeometry();
  pointGeometry.setAttribute('position', geometry.getAttribute('position'));
  state.allPoints = new THREE.Points(pointGeometry, new THREE.PointsMaterial({ color: '#3d4a57', size: 2, sizeAttenuation: false }));
  state.allPoints.visible = $('show-points').checked;
  state.selectedPoints = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: '#ffb000', size: 7, sizeAttenuation: false, depthTest: false }));
  state.selectedPoints.renderOrder = 10;
  scene.add(state.mesh, state.wire, state.allPoints, state.selectedPoints);

  frameModel(geometry.boundingBox);
  history.clear();
  updateSelection([]);
  updateHistoryButtons();
  $('drop-hint').hidden = true;
  $('export').disabled = false;
  const triangles = state.indexArray.length / 3;
  $('model-info').textContent = `${fileName}　頂点 ${state.positions.length / 3}・三角形 ${triangles}${state.canvas ? `・テクスチャ ${state.canvas.width}×${state.canvas.height}` : ''}`;
  setStatus(meshes.length > 1 ? `「${fileName}」を読み込みました。メッシュが${meshes.length}個あったため、最初の1個だけを編集します。` : `「${fileName}」を読み込みました。`);
}

function setupTexture(material) {
  state.canvas = state.context = state.pixels = state.texture = null;
  const image = material?.map?.image;
  if (!image || !state.uvs) { $('mode-paint').disabled = true; return; }
  $('mode-paint').disabled = false;
  const canvas = document.createElement('canvas');
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  state.canvas = canvas; state.context = context;
  state.pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  // glTFのUVは画像の上端がv=0のため、flipYはfalseのまま（GLTFLoaderと同じ）。
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = material.map.wrapS; texture.wrapT = material.map.wrapT;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  state.texture = texture;
  drawTexturePreview();
}

function clearModel() {
  gizmo.detach();
  for (const object of [state.mesh, state.wire, state.allPoints, state.selectedPoints]) if (object) scene.remove(object);
  state.mesh = state.wire = state.allPoints = state.selectedPoints = null;
}

function frameModel(box) {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  orbit.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(size * 1.9));
  camera.near = size / 1000; camera.far = size * 100;
  camera.updateProjectionMatrix();
  orbit.update();
}

async function openFile(file) {
  if (!file) return;
  try { await loadGlb(await file.arrayBuffer(), file.name); }
  catch (error) { setStatus(`GLBを読み込めませんでした：${error.message}`, true); }
}
$('load').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', event => { openFile(event.target.files[0]); event.target.value = ''; });
viewportElement.addEventListener('dragover', event => { event.preventDefault(); viewportElement.classList.add('dragover'); });
viewportElement.addEventListener('dragleave', () => viewportElement.classList.remove('dragover'));
viewportElement.addEventListener('drop', event => { event.preventDefault(); viewportElement.classList.remove('dragover'); openFile(event.dataTransfer.files[0]); });

// ---- 表示切り替え ----
document.querySelectorAll('[data-shading]').forEach(button => button.addEventListener('click', () => {
  state.shading = button.dataset.shading;
  document.querySelectorAll('[data-shading]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
  if (state.mesh) state.mesh.material = state.materials[state.shading];
}));
$('show-wireframe').addEventListener('change', event => { if (state.wire) state.wire.visible = event.target.checked; });
$('show-points').addEventListener('change', event => { if (state.allPoints) state.allPoints.visible = event.target.checked; });

// ---- モード ----
function setMode(mode) {
  if (mode === 'paint' && !state.canvas) return;
  state.mode = mode;
  $('mode-select').setAttribute('aria-pressed', String(mode === 'select'));
  $('mode-paint').setAttribute('aria-pressed', String(mode === 'paint'));
  $('select-panel').hidden = mode !== 'select';
  $('paint-panel').hidden = mode !== 'paint';
  renderer.domElement.classList.toggle('paint-mode', mode === 'paint');
  updateGizmo();
  updateHelp();
}
function updateHelp() {
  $('view-help').textContent = state.mode === 'select'
    ? 'クリック：頂点を選ぶ／Shift＋クリック・ドラッグ：追加／Cmd(Ctrl)＋クリック・ドラッグ：外す／何もない所をドラッグ：回転・右ドラッグ：平行移動・ホイール：ズーム'
    : 'モデルの上をドラッグ：塗る／Alt(Option)＋クリック：スポイト（スタンプではコピー元の指定）／何もない所をドラッグ：回転';
}
$('mode-select').addEventListener('click', () => setMode('select'));
$('mode-paint').addEventListener('click', () => setMode('paint'));

// ---- 選択 ----
function updateSelection(indices, first = state.firstSelected) {
  state.selection = indices;
  state.firstSelected = indices.length ? (indices.includes(first) ? first : indices[0]) : null;
  $('selection-count').textContent = `${indices.length} 個選択`;
  if (state.selectedPoints) {
    const values = new Float32Array(indices.length * 3);
    indices.forEach((index, i) => values.set(getVertex(state.positions, index), i * 3));
    state.selectedPoints.geometry.setAttribute('position', new THREE.BufferAttribute(values, 3));
  }
  updateGizmo();
  updateFlattenValue();
}
function updateGizmo() {
  if (state.mode === 'select' && state.selection.length) {
    pivot.position.fromArray(selectionCenter(state.positions, state.selection));
    gizmo.attach(pivot);
  } else gizmo.detach();
}
function refreshSelectedPoints() { updateSelection(state.selection, state.firstSelected); }

const raycaster = new THREE.Raycaster();
function pointerNdc(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  return new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
}
function hitTest(event) {
  if (!state.mesh) return null;
  raycaster.setFromCamera(pointerNdc(event), camera);
  return raycaster.intersectObject(state.mesh, false)[0] ?? null;
}
function pickVertices(hit) {
  const radius = Number($('select-radius').value);
  if (radius > 0) return expandToGroups(verticesWithinRadius(state.positions, hit.point.toArray(), radius), state.groups);
  const { a, b, c } = hit.face;
  const nearest = [a, b, c].reduce((best, index) => hit.point.distanceToSquared(new THREE.Vector3(...getVertex(state.positions, index))) < hit.point.distanceToSquared(new THREE.Vector3(...getVertex(state.positions, best))) ? index : best);
  return expandToGroups([nearest], state.groups);
}
function combineSelection(picked, event) {
  if (event.metaKey || event.ctrlKey) { const remove = new Set(picked); return state.selection.filter(index => !remove.has(index)); }
  if (event.shiftKey) return [...new Set([...state.selection, ...picked])].sort((a, b) => a - b);
  return picked;
}
// 画面上の矩形に入る頂点。裏側を除く場合は、カメラから頂点までの間に面が無いかを確かめる。
function verticesInRect(x0, y0, x1, y1, includeBackfaces) {
  const rect = renderer.domElement.getBoundingClientRect();
  const result = [];
  const vector = new THREE.Vector3();
  const visibleGroups = new Map();
  for (let index = 0; index < state.positions.length / 3; index++) {
    vector.fromArray(state.positions, index * 3).project(camera);
    const sx = (vector.x + 1) / 2 * rect.width + rect.left, sy = (1 - vector.y) / 2 * rect.height + rect.top;
    if (sx < x0 || sx > x1 || sy < y0 || sy > y1 || vector.z > 1) continue;
    if (!includeBackfaces) {
      const group = state.groups.groupOf[index];
      if (!visibleGroups.has(group)) {
        const point = new THREE.Vector3().fromArray(state.positions, index * 3);
        const direction = point.clone().sub(camera.position);
        const distance = direction.length();
        raycaster.set(camera.position, direction.normalize());
        const hit = raycaster.intersectObject(state.mesh, false)[0];
        visibleGroups.set(group, !hit || hit.distance >= distance - distance * 1e-3);
      }
      if (!visibleGroups.get(group)) continue;
    }
    result.push(index);
  }
  return expandToGroups(result, state.groups);
}

$('select-radius').addEventListener('input', event => { $('select-radius-value').textContent = Number(event.target.value).toFixed(3); });
$('clear-selection').addEventListener('click', () => updateSelection([]));
$('grow-selection').addEventListener('click', () => { if (state.mesh && state.selection.length) updateSelection(growSelection(state.selection, state.indexArray, state.groups)); });

// ---- 頂点編集（Undoは位置と法線の全体コピーで記録する。3000頂点程度なら1回70KB前後で済む） ----
function geometryChanged(movedIndices) {
  const geometry = state.mesh.geometry;
  if (movedIndices) recomputeNormals(state.positions, state.normals, state.indexArray, state.groups, movedIndices);
  geometry.getAttribute('position').needsUpdate = true;
  geometry.getAttribute('normal').needsUpdate = true;
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  refreshSelectedPoints();
}
function pushGeometryHistory(label, before) {
  const after = { positions: state.positions.slice(), normals: state.normals.slice() };
  const restore = snapshot => { state.positions.set(snapshot.positions); state.normals.set(snapshot.normals); geometryChanged(null); };
  history.push({ label, undo: () => restore(before), redo: () => restore(after) });
  updateHistoryButtons();
}
const geometrySnapshot = () => ({ positions: state.positions.slice(), normals: state.normals.slice() });

function editSelection(label, apply) {
  if (!state.mesh || !state.selection.length) { setStatus('先に頂点を選んでください。', true); return; }
  const before = geometrySnapshot();
  apply();
  geometryChanged(state.selection);
  pushGeometryHistory(label, before);
  setStatus(`${label}：${state.selection.length} 頂点`);
}

let dragBefore = null, lastPivot = new THREE.Vector3();
gizmo.addEventListener('dragging-changed', event => { orbit.enabled = !event.value; });
gizmo.addEventListener('mouseDown', () => { dragBefore = geometrySnapshot(); lastPivot.copy(pivot.position); });
gizmo.addEventListener('objectChange', () => {
  if (!dragBefore) return;
  const delta = pivot.position.clone().sub(lastPivot);
  lastPivot.copy(pivot.position);
  moveVertices(state.positions, state.selection, delta.toArray());
  state.mesh.geometry.getAttribute('position').needsUpdate = true;
  const values = state.selectedPoints.geometry.getAttribute('position');
  if (values) { state.selection.forEach((index, i) => values.setXYZ(i, ...getVertex(state.positions, index))); values.needsUpdate = true; }
});
gizmo.addEventListener('mouseUp', () => {
  if (!dragBefore) return;
  const moved = state.positions.some((value, index) => value !== dragBefore.positions[index]);
  if (moved) { geometryChanged(state.selection); pushGeometryHistory('移動', dragBefore); setStatus(`${state.selection.length} 頂点を移動しました。`); }
  dragBefore = null;
});
$('move-snap').addEventListener('input', event => { const value = Number(event.target.value); gizmo.setTranslationSnap(value > 0 ? value : null); });
$('nudge-apply').addEventListener('click', () => {
  const delta = ['nudge-x', 'nudge-y', 'nudge-z'].map(id => Number($(id).value) || 0);
  if (delta.every(value => value === 0)) { setStatus('動かす量を入れてください。', true); return; }
  editSelection('数値で移動', () => moveVertices(state.positions, state.selection, delta));
});

let flattenAxis = 0;
document.querySelectorAll('#flatten-axis [data-axis]').forEach(button => button.addEventListener('click', () => {
  flattenAxis = Number(button.dataset.axis);
  document.querySelectorAll('#flatten-axis [data-axis]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
  updateFlattenValue();
}));
$('flatten-mode').addEventListener('change', updateFlattenValue);
function updateFlattenValue() {
  const value = state.selection.length ? flattenTarget(state.positions, state.selection, flattenAxis, $('flatten-mode').value, state.firstSelected) : null;
  $('flatten-value').value = value === null ? '' : value.toFixed(4);
}
$('flatten-apply').addEventListener('click', () => {
  const value = Number($('flatten-value').value);
  if ($('flatten-value').value === '' || !Number.isFinite(value)) { setStatus('揃える値を入れてください。', true); return; }
  editSelection(`${'XYZ'[flattenAxis]}を${value.toFixed(4)}に揃える`, () => flattenVertices(state.positions, state.selection, flattenAxis, value));
});

// ---- ペイント ----
document.querySelectorAll('#paint-tool [data-tool]').forEach(button => button.addEventListener('click', () => setPaintTool(button.dataset.tool)));
function setPaintTool(tool) {
  state.paintTool = tool;
  document.querySelectorAll('#paint-tool [data-tool]').forEach(other => other.setAttribute('aria-pressed', String(other.dataset.tool === tool)));
  $('paint-note').textContent = {
    brush: '選んだ色で塗ります。Alt(Option)＋クリックでモデルから色を拾えます。',
    stamp: 'Alt(Option)＋クリックでコピー元を決めてから塗ると、コピー元の模様ごと写します。壁の塗りむらを残したまま欠けを埋めたいときに。',
    eyedropper: 'モデルをクリックすると、その場所の色を拾って筆に切り替えます。',
  }[tool] + (tool === 'stamp' && state.stampSource ? '（コピー元：指定済み）' : '');
}
const sliders = [['brush-size', 0], ['brush-opacity', 2], ['brush-hardness', 2]];
for (const [id, digits] of sliders) $(id).addEventListener('input', event => { $(`${id}-value`).textContent = Number(event.target.value).toFixed(digits); });
$('paint-color').addEventListener('input', event => { $('paint-color-hex').textContent = event.target.value; });

function texelAt(hit) {
  if (!hit?.uv) return null;
  const wrap = value => value - Math.floor(value);
  return [wrap(hit.uv.x) * state.canvas.width, wrap(hit.uv.y) * state.canvas.height];
}
function pickColor(hit) {
  const texel = texelAt(hit);
  if (!texel) return;
  const rgb = sampleColor(state.pixels.data, state.canvas.width, state.canvas.height, texel[0], texel[1], 3);
  $('paint-color').value = rgbToHex(rgb);
  $('paint-color-hex').textContent = rgbToHex(rgb);
  setStatus(`色を拾いました：${rgbToHex(rgb)}`);
}

let stroke = null;
function beginStroke(hit) {
  stroke = { before: new Uint8ClampedArray(state.pixels.data), rect: null, offset: null };
  if (state.paintTool === 'stamp') {
    if (!state.stampSource) { setStatus('スタンプは、先にAlt(Option)＋クリックでコピー元を指定してください。', true); stroke = null; return; }
    const texel = texelAt(hit);
    stroke.offset = [state.stampSource[0] - texel[0], state.stampSource[1] - texel[1]];
  }
  continueStroke(hit);
}
function continueStroke(hit) {
  const texel = texelAt(hit);
  if (!stroke || !texel) return;
  const { width, height } = state.canvas;
  const radius = Number($('brush-size').value) / 2, opacity = Number($('brush-opacity').value), hardness = Number($('brush-hardness').value);
  const rect = state.paintTool === 'stamp'
    ? stampCircle(state.pixels.data, stroke.before, width, height, texel[0], texel[1], radius, stroke.offset[0], stroke.offset[1], opacity, hardness)
    : paintCircle(state.pixels.data, width, height, texel[0], texel[1], radius, hexToRgb($('paint-color').value), opacity, hardness);
  if (!rect) return;
  state.context.putImageData(state.pixels, 0, 0, rect.x, rect.y, rect.w, rect.h);
  state.texture.needsUpdate = true;
  stroke.rect = stroke.rect ? unionRect(stroke.rect, rect) : rect;
}
function endStroke() {
  if (!stroke) return;
  const { rect, before } = stroke;
  stroke = null;
  if (!rect) return;
  // Undoには塗った範囲の矩形だけを前後で控える（2Kテクスチャ全体を毎回持つと重いため）。
  const beforePatch = cropPixels(before, state.canvas.width, rect), afterPatch = cropPixels(state.pixels.data, state.canvas.width, rect);
  const restore = patch => { pastePixels(state.pixels.data, state.canvas.width, rect, patch); state.context.putImageData(state.pixels, 0, 0, rect.x, rect.y, rect.w, rect.h); state.texture.needsUpdate = true; state.lastPaintRect = rect; drawTexturePreview(); };
  history.push({ label: 'ペイント', undo: () => restore(beforePatch), redo: () => restore(afterPatch) });
  state.lastPaintRect = rect;
  updateHistoryButtons();
  drawTexturePreview();
}
const unionRect = (a, b) => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
function cropPixels(data, width, rect) {
  const patch = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) patch.set(data.subarray(((rect.y + y) * width + rect.x) * 4, ((rect.y + y) * width + rect.x + rect.w) * 4), y * rect.w * 4);
  return patch;
}
function pastePixels(data, width, rect, patch) {
  for (let y = 0; y < rect.h; y++) data.set(patch.subarray(y * rect.w * 4, (y + 1) * rect.w * 4), ((rect.y + y) * width + rect.x) * 4);
}
function drawTexturePreview() {
  const preview = $('texture-preview');
  if (!state.canvas) return;
  const scale = 512 / Math.max(state.canvas.width, state.canvas.height);
  preview.width = Math.round(state.canvas.width * scale); preview.height = Math.round(state.canvas.height * scale);
  const context = preview.getContext('2d');
  context.drawImage(state.canvas, 0, 0, preview.width, preview.height);
  if (state.lastPaintRect) {
    const { x, y, w, h } = state.lastPaintRect;
    context.strokeStyle = '#ff3b3b'; context.lineWidth = 2;
    context.strokeRect(x * scale - 2, y * scale - 2, w * scale + 4, h * scale + 4);
  }
}

// ---- ポインター操作（OrbitControlsより先に受け取るためcaptureで登録し、必要なときだけ回転を止める） ----
let pointer = null;
const selectRect = $('select-rect');
renderer.domElement.addEventListener('pointerdown', event => {
  if (!state.mesh || event.button !== 0) return;
  // ギズモの矢印の上（ホバー中の軸がある）なら、TransformControlsに任せる。
  if (state.mode === 'select' && gizmo.axis) return;
  pointer = { x: event.clientX, y: event.clientY, rect: false, painting: false };
  if (state.mode === 'select' && (event.shiftKey || event.metaKey || event.ctrlKey)) {
    pointer.rect = true; orbit.enabled = false;
  } else if (state.mode === 'paint') {
    const hit = hitTest(event);
    if (hit) {
      orbit.enabled = false;
      if (event.altKey || state.paintTool === 'eyedropper') {
        if (state.paintTool === 'stamp') { state.stampSource = texelAt(hit); setPaintTool('stamp'); setStatus('スタンプのコピー元を決めました。塗りたい場所をドラッグしてください。'); }
        else { pickColor(hit); if (state.paintTool === 'eyedropper') setPaintTool('brush'); }
      } else { pointer.painting = true; beginStroke(hit); }
    }
  }
  renderer.domElement.setPointerCapture(event.pointerId);
}, { capture: true });
renderer.domElement.addEventListener('pointermove', event => {
  if (!pointer) return;
  if (pointer.rect) {
    const host = viewportElement.getBoundingClientRect();
    Object.assign(selectRect.style, {
      left: `${Math.min(pointer.x, event.clientX) - host.left}px`, top: `${Math.min(pointer.y, event.clientY) - host.top}px`,
      width: `${Math.abs(event.clientX - pointer.x)}px`, height: `${Math.abs(event.clientY - pointer.y)}px`,
    });
    selectRect.hidden = Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 4;
  } else if (pointer.painting) {
    // ポインターイベントの間隔が空くと筆の跡が点々になるため、画面上で2pxごとに補間して塗る
    // （テクスチャ上で補間すると、UVの島をまたいだときにアトラスを横切る線になってしまう）。
    const from = pointer.last ?? { x: pointer.x, y: pointer.y };
    const steps = Math.max(1, Math.ceil(Math.hypot(event.clientX - from.x, event.clientY - from.y) / 2));
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      continueStroke(hitTest({ clientX: from.x + (event.clientX - from.x) * t, clientY: from.y + (event.clientY - from.y) * t }));
    }
    pointer.last = { x: event.clientX, y: event.clientY };
  }
});
renderer.domElement.addEventListener('pointerup', event => {
  if (!pointer) return;
  const moved = Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) >= 4;
  if (state.mode === 'select' && !dragBefore) {
    if (pointer.rect && moved) {
      const picked = verticesInRect(Math.min(pointer.x, event.clientX), Math.min(pointer.y, event.clientY), Math.max(pointer.x, event.clientX), Math.max(pointer.y, event.clientY), $('select-backfaces').checked);
      updateSelection(combineSelection(picked, event));
    } else if (!moved) {
      const hit = hitTest(event);
      if (hit) {
        const picked = pickVertices(hit);
        updateSelection(combineSelection(picked, event), event.shiftKey ? state.firstSelected : picked[0]);
      } else if (!event.shiftKey && !event.metaKey && !event.ctrlKey) updateSelection([]);
    }
  }
  if (pointer.painting) endStroke();
  selectRect.hidden = true;
  pointer = null;
  orbit.enabled = true;
});

// ---- Undo / 書き出し / キー操作 ----
function updateHistoryButtons() { $('undo').disabled = !history.canUndo; $('redo').disabled = !history.canRedo; }
function undo() { const entry = history.undo(); if (entry) setStatus(`元に戻しました：${entry.label}`); updateHistoryButtons(); }
function redo() { const entry = history.redo(); if (entry) setStatus(`やり直しました：${entry.label}`); updateHistoryButtons(); }
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);

async function exportGlb() {
  if (!state.mesh) return;
  const geometry = state.mesh.geometry.clone();
  let map = null;
  if (state.canvas) {
    map = new THREE.CanvasTexture(state.canvas);
    map.flipY = false;
    map.colorSpace = THREE.SRGBColorSpace;
    map.userData.mimeType = 'image/jpeg'; // Tripoの元データと同じくJPEGで埋め込み、容量を抑える
  }
  const material = new THREE.MeshStandardMaterial({ map, color: map ? '#ffffff' : state.materials.texture.color, roughness: 0.9, metalness: 0 });
  const baseName = (state.fileName ?? 'model.glb').replace(/\.glb$/i, '');
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = baseName;
  const exportScene = new THREE.Scene();
  exportScene.add(mesh);
  const buffer = await new GLTFExporter().parseAsync(exportScene, { binary: true });
  const blob = new Blob([buffer], { type: 'model/gltf-binary' });
  const suggestedName = baseName.endsWith('_fixed') ? `${baseName}.glb` : `${baseName}_fixed.glb`;
  // Chrome系なら保存場所を選べる（Railariumのフォルダへ直接置ける）。それ以外は通常のダウンロード。
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName, types: [{ description: 'glTF Binary', accept: { 'model/gltf-binary': ['.glb'] } }] });
      const writable = await handle.createWritable();
      await writable.write(blob); await writable.close();
      setStatus(`「${handle.name}」に書き出しました（${(blob.size / 1024).toFixed(0)}KB）。`);
      return;
    } catch (error) { if (error.name === 'AbortError') return; }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = suggestedName; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  setStatus(`「${suggestedName}」を書き出しました（${(blob.size / 1024).toFixed(0)}KB）。`);
}
$('export').addEventListener('click', () => exportGlb().catch(error => setStatus(`書き出せませんでした：${error.message}`, true)));

window.addEventListener('keydown', event => {
  if (event.target.closest?.('input, select, textarea')) return;
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
  if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
  if (modifier) return;
  if (event.key === 'v' || event.key === 'V') setMode('select');
  else if (event.key === 'p' || event.key === 'P') setMode('paint');
  else if (event.key === 'Escape') updateSelection([]);
});

// テストやMCP連携から状態を覗けるようにしておく（画面の動作には使わない）。
window.glbFix = { state, history, camera, orbit, loadGlb, exportGlb, updateSelection, setMode };
setMode('select');
setPaintTool('brush');
