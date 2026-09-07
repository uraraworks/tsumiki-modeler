import * as THREE from 'three';
import { PALETTE_CHARS, applyAnimationFrame, cloneDoc, createNewDoc, createSampleDoc, createChestSampleDoc, createTeapotSampleDoc, createPart, createBone, convertPartToMesh, duplicatePart, estimateMeshConversion, extrudeMeshFace, mergeParts, mirrorPart, moveMeshVertices, resizePartTexture, serializeDoc, deserializeDoc, textureLayout, weldVertices } from './model.js';
import { CommandHistory } from './commands.js';
import { createViewport } from './viewport.js';
import { connectMcpBridge } from './bridge.js';
import { validateModelReport } from './model-validation.js';
import { VERSION_FOOTER } from './version.js';
const $ = selector => document.querySelector(selector);
// どのビルドを見ているか識別するための版文字列(git commit時刻+ハッシュ由来。
// 生成は tools/update-version.mjs、詳細は src/version.js / tools/version.mjs 参照)。
const footerVersionEl = $('#app-footer-version');
if (footerVersionEl) footerVersionEl.textContent = VERSION_FOOTER;
const partTypeLabel = part => part.type === 'box' ? '箱'
  : part.type === 'sphere' ? '球'
    : part.type === 'capsule' ? 'カプセル'
      : part.type === 'mesh' ? 'メッシュ'
        : (part.radiusTop !== undefined || part.radiusBottom !== undefined) ? '円錐台' : '円柱';
let doc = createSampleDoc();
// 選択は一時的なUI状態。モデルの編集状態はdocのみに置く。
// selectedIdsが選択の実体。selectedIdは「1個だけ選択中のときのそのID（それ以外はnull）」で、
// 既存のギズモ・プロパティ編集など単一選択前提のコードはこれまで通りselectedIdだけを見ればよい。
let selectedIds = ['p2'];
let selectedId = 'p2';
let selectedBoneId = null;
const history = new CommandHistory();
let viewport;
let transformMode = 'translate';
let boneTool = 'rotate';
let paintTool = 'pen';
let paintColorIndex = 0;
let renderedPalette = '';
let activeSample = 'human';
let currentFrame = 0;
let playing = false;
let playbackRequest = 0;
let playbackStartTime = 0;
let playbackStartFrame = 0;
let timelineDragging = false;
let outlineMode = 'edge';
let selectedFaces = [];
let selectedVertices = [];
let meshSubmode = 'vertex';
const activeAnimation = () => doc.animations?.[0] ?? null;
const status = (message, error = false) => {
  $('#status').textContent = message;
  $('#status').classList.toggle('error', error);
};
function refresh() {
  selectedIds = selectedIds.filter(id => doc.parts.some(p => p.id === id));
  if (!doc.parts.some(p => p.id === selectedId)) selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  if (!doc.bones.some(bone => bone.id === selectedBoneId)) selectedBoneId = null;
  const selectedPartForFaces = doc.parts.find(p => p.id === selectedId);
  selectedFaces = selectedPartForFaces?.type === 'mesh' ? selectedFaces.filter(index => index < selectedPartForFaces.faces.length) : [];
  selectedVertices = selectedPartForFaces?.type === 'mesh' ? selectedVertices.filter(index => index < selectedPartForFaces.vertices.length) : [];
  viewport?.rebuild(doc, selectedId, selectedBoneId, selectedIds);
  viewport?.setFaceSelection(selectedFaces);
  viewport?.setVertexSelection(selectedVertices);
  updateFaceUi();
  $('#part-count').textContent = `${doc.parts.length} 個`;
  $('#merge-parts').disabled = selectedIds.length < 2;
  const paletteKey = JSON.stringify(doc.palette);
  if (paletteKey !== renderedPalette) {
    renderedPalette = paletteKey;
    $('#palette').replaceChildren(...doc.palette.map((color, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.style.backgroundColor = color; button.setAttribute('aria-label', `色を${color}に変更`);
      button.dataset.index = index;
      button.addEventListener('click', () => setPaintColor(index));
      return button;
    }));
  }
  if (paintColorIndex >= doc.palette.length) paintColorIndex = 0;
  updatePaintUi();
  $('#part-list').replaceChildren(...doc.parts.map(part => {
    const li = document.createElement('li'), button = document.createElement('button');
    button.type = 'button'; button.setAttribute('aria-pressed', String(selectedIds.includes(part.id)));
    const swatch = document.createElement('span'); swatch.className = 'part-swatch'; swatch.style.backgroundColor = part.color;
    const name = document.createElement('span'); name.className = 'part-label'; name.textContent = part.name;
    const kind = document.createElement('span'); kind.className = 'part-kind'; kind.textContent = partTypeLabel(part);
    button.append(swatch, name, kind); button.addEventListener('click', event => selectInList(part.id, event)); li.append(button); return li;
  }));
  const part = doc.parts.find(p => p.id === selectedId);
  $('#delete').disabled = !part;
  $('#duplicate').disabled = !part; $('#mirror').disabled = !part;
  $('#convert-to-mesh').disabled = !part || part.type === 'mesh';
  $('#undo').disabled = !history.past.length; $('#redo').disabled = !history.future.length;
  $('#sample-new').setAttribute('aria-pressed', String(activeSample === 'new'));
  $('#sample-human').setAttribute('aria-pressed', String(activeSample === 'human'));
  $('#sample-chest').setAttribute('aria-pressed', String(activeSample === 'chest'));
  $('#sample-teapot').setAttribute('aria-pressed', String(activeSample === 'teapot'));
  const multiSelected = selectedIds.length > 1;
  $('#properties-form').hidden = !part; $('#empty-selection').hidden = !!part || multiSelected;
  $('#multi-selection').hidden = !multiSelected;
  if (multiSelected) $('#multi-selection').textContent = `${selectedIds.length} 個のパーツを選択中です。プロパティ編集は1つだけ選択しているときにできます。「結合」でこれらを1つのメッシュにまとめられます。`;
  $('#part-type').textContent = part ? partTypeLabel(part) : '';
  $('#uv-preview-section').hidden = !part;
  $('#bones-section').hidden = !['bone', 'animation'].includes(transformMode);
  $('#bone-count').textContent = `${doc.bones.length} 本`;
  renderBoneTree();
  const bone = doc.bones.find(candidate => candidate.id === selectedBoneId);
  $('#bone-properties-form').hidden = !bone; $('#empty-bone-selection').hidden = !!bone;
  $('#remove-bone').disabled = !bone;
  if (bone) {
    $('#bone-name').value = bone.name;
    const descendants = boneDescendants(bone.id);
    $('#bone-parent').replaceChildren(
      new Option('なし（ルート）', ''),
      ...doc.bones.filter(candidate => candidate.id !== bone.id && !descendants.has(candidate.id)).map(candidate => new Option(candidate.name, candidate.id)),
    );
    $('#bone-parent').value = bone.parent ?? '';
    document.querySelectorAll('[data-bone-vector]').forEach(input => { input.value = bone[input.dataset.boneVector][Number(input.dataset.axis)]; });
  }
  renderTimeline();
  $('#part-bone').replaceChildren(new Option('なし', ''), ...doc.bones.map(candidate => new Option(candidate.name, candidate.id)));
  if (!part) return;
  $('#part-name').value = part.name;
  $('#part-bone').value = part.bone ?? '';
  $('#part-color').value = part.color; $('#color-value').textContent = part.color;
  const isFrustum = part.type === 'cylinder' && (part.radiusTop !== undefined || part.radiusBottom !== undefined);
  const fieldVisibility = { box: part.type === 'box', cylinder: part.type === 'cylinder' && !isFrustum, frustum: isFrustum, sphere: part.type === 'sphere', capsule: part.type === 'capsule', mesh: part.type === 'mesh' };
  for (const [name, visible] of Object.entries(fieldVisibility)) { $(`#${name}-fields`).hidden = !visible; $(`#${name}-fields`).disabled = !visible; }
  if (part.type === 'mesh') {
    $('#mesh-vertex-count').textContent = `${part.vertices.length} 個`;
    $('#mesh-face-count').textContent = `${part.faces.length} 個`;
  }
  $('#weld-vertices').disabled = part?.type !== 'mesh';
  document.querySelectorAll('[data-vector]').forEach(input => {
    const value = part[input.dataset.vector];
    if (Array.isArray(value)) input.value = value[Number(input.dataset.axis)];
  });
  document.querySelectorAll('[data-scalar]').forEach(input => {
    const key = input.dataset.scalar;
    const value = part[key] ?? (['radiusTop', 'radiusBottom'].includes(key) ? part.radius : undefined);
    if (value !== undefined) input.value = value;
  });
  renderUvPreview(part);
}
function boneDescendants(boneId) {
  const result = new Set(), visit = id => {
    for (const bone of doc.bones.filter(candidate => candidate.parent === id)) { result.add(bone.id); visit(bone.id); }
  };
  visit(boneId); return result;
}
function renderBoneTree() {
  const children = parent => doc.bones.filter(bone => bone.parent === parent);
  const makeBranch = bone => {
    const li = document.createElement('li'), button = document.createElement('button');
    button.type = 'button'; button.textContent = bone.name; button.setAttribute('aria-pressed', String(bone.id === selectedBoneId));
    button.addEventListener('click', () => { selectedBoneId = bone.id; refresh(); }); li.append(button);
    const nested = children(bone.id);
    if (nested.length) { const ul = document.createElement('ul'); ul.append(...nested.map(makeBranch)); li.append(ul); }
    return li;
  };
  $('#bone-tree').replaceChildren(...children(null).map(makeBranch));
}
function updateTimelineCurrent() {
  $('#animation-frame').textContent = `${currentFrame} / ${Math.max(0, (activeAnimation()?.length ?? 1) - 1)}`;
  document.querySelectorAll('.timeline-cell.current').forEach(cell => cell.classList.remove('current'));
  document.querySelectorAll(`.timeline-cell[data-frame="${currentFrame}"]`).forEach(cell => cell.classList.add('current'));
}
function updatePlaybackUi() {
  const button = $('#animation-play');
  button.textContent = playing ? '■' : '▶';
  button.setAttribute('aria-label', playing ? '停止' : '再生');
  button.setAttribute('aria-pressed', String(playing));
  $('#animation-set-key').disabled = playing || !selectedBoneId;
  $('#animation-remove-key').disabled = playing || !selectedBoneId;
}
function renderTimeline() {
  const animation = activeAnimation(), grid = $('#timeline-grid');
  if (!animation) { grid.replaceChildren(); updatePlaybackUi(); return; }
  currentFrame = Math.min(currentFrame, animation.length - 1);
  $('#animation-length').value = animation.length;
  $('#animation-fps').value = animation.fps;
  const columns = `110px repeat(${animation.length}, 24px)`;
  const makeCell = (frame, key = false, text = '') => {
    const cell = document.createElement('div');
    cell.className = `timeline-cell${key ? ' key' : ''}`; cell.dataset.frame = frame; cell.textContent = text;
    return cell;
  };
  const ruler = document.createElement('div'); ruler.className = 'timeline-row timeline-ruler'; ruler.style.gridTemplateColumns = columns;
  const rulerLabel = document.createElement('div'); rulerLabel.className = 'timeline-label'; rulerLabel.textContent = animation.name;
  ruler.append(rulerLabel, ...Array.from({ length: animation.length }, (_, frame) => makeCell(frame, false, frame % 5 === 0 ? frame : '')));
  const tracks = new Map(animation.tracks.map(track => [track.boneId, track]));
  const rows = doc.bones.map(bone => {
    const row = document.createElement('div'); row.className = 'timeline-row'; row.style.gridTemplateColumns = columns;
    const label = document.createElement('button'); label.type = 'button'; label.className = 'timeline-label'; label.textContent = bone.name;
    label.setAttribute('aria-pressed', String(bone.id === selectedBoneId));
    label.addEventListener('click', () => { selectedBoneId = bone.id; refresh(); });
    const keyedFrames = new Set((tracks.get(bone.id)?.keys ?? []).map(key => key.frame));
    row.append(label, ...Array.from({ length: animation.length }, (_, frame) => makeCell(frame, keyedFrames.has(frame))));
    return row;
  });
  grid.replaceChildren(ruler, ...rows);
  updateTimelineCurrent(); updatePlaybackUi();
}
function setCurrentFrame(frame) {
  const animation = activeAnimation();
  if (!animation) return;
  currentFrame = Math.max(0, Math.min(animation.length - 1, Math.trunc(frame)));
  doc = applyAnimationFrame(doc, animation.id, currentFrame, THREE);
  viewport?.updateBonePose(doc);
  const bone = doc.bones.find(candidate => candidate.id === selectedBoneId);
  if (bone) document.querySelectorAll('[data-bone-vector="rotation"]').forEach(input => { input.value = bone.rotation[Number(input.dataset.axis)]; });
  updateTimelineCurrent();
}
function stopPlayback() {
  if (playbackRequest) cancelAnimationFrame(playbackRequest);
  playbackRequest = 0; playing = false;
  viewport?.setEditingEnabled(true); updatePlaybackUi();
}
function startPlayback() {
  const animation = activeAnimation();
  if (!animation || playing) return;
  playing = true; playbackStartTime = performance.now(); playbackStartFrame = currentFrame;
  viewport?.setEditingEnabled(false); updatePlaybackUi();
  const tick = timestamp => {
    if (!playing) return;
    const advanced = Math.floor((timestamp - playbackStartTime) * animation.fps / 1000);
    const frame = (playbackStartFrame + advanced) % animation.length;
    if (frame !== currentFrame) setCurrentFrame(frame);
    playbackRequest = requestAnimationFrame(tick);
  };
  playbackRequest = requestAnimationFrame(tick);
}
function renderUvPreview(part) {
  const canvas = $('#uv-preview'), note = $('#uv-preview-note');
  const layout = textureLayout(part, doc.texelsPerUnit);
  const [width, height] = layout.size;
  const scale = Math.max(1, Math.min(8, Math.floor(246 / width)));
  if (width * scale > 8192 || height * scale > 8192 || width * height * scale * scale > 16000000) {
    canvas.hidden = true; note.textContent = `${width} × ${height}px（プレビューには大きすぎます）`; return;
  }
  canvas.hidden = false; note.textContent = `${width} × ${height}px · ${doc.texelsPerUnit}px/グリッド${['sphere', 'capsule'].includes(part.type) ? ' · 極付近はUVが歪みます' : ''}`;
  canvas.width = width * scale; canvas.height = height * scale;
  const context = canvas.getContext('2d');
  context.fillStyle = part.color; context.fillRect(0, 0, canvas.width, canvas.height);
  if (part.texture) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const character = part.texture.rows[y][x];
    if (character === '.') continue;
    context.fillStyle = doc.palette[PALETTE_CHARS.indexOf(character)];
    context.fillRect(x * scale, y * scale, scale, scale);
  }
  context.lineWidth = 1; context.strokeStyle = 'rgba(225,235,244,.75)';
  context.font = '10px system-ui, sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
  for (const [name, [x, y, faceWidth, faceHeight]] of Object.entries(layout.faces)) {
    if (faceWidth <= 0 || faceHeight <= 0) continue;
    const left = x * scale, top = y * scale, drawnWidth = faceWidth * scale, drawnHeight = faceHeight * scale;
    if (part.type === 'cylinder' && name !== 'side' && faceWidth > 0 && faceHeight > 0) {
      context.beginPath(); context.ellipse(left + drawnWidth / 2, top + drawnHeight / 2, drawnWidth / 2 - .5, drawnHeight / 2 - .5, 0, 0, Math.PI * 2); context.stroke();
    } else context.strokeRect(left + .5, top + .5, drawnWidth - 1, drawnHeight - 1);
    const labelWidth = context.measureText(name).width + 5;
    context.fillStyle = 'rgba(15,20,25,.7)'; context.fillRect(left + (drawnWidth - labelWidth) / 2, top + (drawnHeight - 11) / 2, labelWidth, 11);
    context.fillStyle = '#f1f5f8'; context.fillText(name, left + drawnWidth / 2, top + drawnHeight / 2);
  }
}
function previewPaintPixels(partId, pixels) {
  if (partId !== selectedId) return;
  const part = doc.parts.find(candidate => candidate.id === partId);
  const canvas = $('#uv-preview');
  if (!part || canvas.hidden) return;
  const [width] = textureLayout(part, doc.texelsPerUnit).size;
  const scale = canvas.width / width, context = canvas.getContext('2d');
  for (const [x, y, character] of pixels) {
    context.fillStyle = character === '.' ? part.color : doc.palette[PALETTE_CHARS.indexOf(character)];
    context.fillRect(x * scale, y * scale, scale, scale);
  }
}
function applySelection(ids) {
  selectedIds = ids;
  selectedId = ids.length === 1 ? ids[0] : null;
  selectedFaces = []; selectedVertices = [];
  refresh();
}
// 単一選択の入口（3Dビューポートのクリック、複製・ミラー・追加直後の選択などから使う）。
function select(id) {
  applySelection(id ? [id] : []);
  if (transformMode === 'face') status(faceModeStatusMessage());
}
// パーツ一覧のクリック専用。Ctrl/Cmd+クリックでトグル、Shift+クリックで範囲選択、修飾キー無しは単一選択。
function selectInList(id, event) {
  const additive = event.ctrlKey || event.metaKey;
  const range = event.shiftKey;
  if (range && selectedIds.length) {
    const ids = doc.parts.map(p => p.id);
    const anchorIndex = ids.indexOf(selectedIds[selectedIds.length - 1]);
    const targetIndex = ids.indexOf(id);
    if (anchorIndex >= 0 && targetIndex >= 0) {
      const [from, to] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
      applySelection([...new Set([...selectedIds, ...ids.slice(from, to + 1)])]);
      return;
    }
  }
  if (additive) {
    applySelection(selectedIds.includes(id) ? selectedIds.filter(existing => existing !== id) : [...selectedIds, id]);
    return;
  }
  select(id);
}
// メッシュ編集モードで、選択中パーツの状態に応じた案内文を返す（未変換パーツでは何も起きない問題への対策）。
function faceModeStatusMessage() {
  const part = doc.parts.find(p => p.id === selectedId);
  if (!part) return 'メッシュパーツを選択すると頂点・面を編集できます。';
  if (part.type === 'mesh') {
    return meshSubmode === 'vertex'
      ? `${part.name}：頂点をクリックして選択し（Shiftで複数選択）、ギズモで1グリッド単位に移動します。選択中のパーツの頂点のみ操作できます。`
      : `${part.name}：面をクリックして選択し、距離を指定して押し出します。選択中のパーツの面のみ操作できます。`;
  }
  if (part.type === 'box') return `${part.name} は箱です。「メッシュに変換」を押すと頂点・面を編集できます。`;
  return `${part.name} は${partTypeLabel(part)}です。この形状はまだメッシュに変換できません。`;
}
function updateFaceUi() {
  const faceTools = $('#face-tools');
  if (!faceTools) return;
  faceTools.hidden = transformMode !== 'face';
  $('#mesh-submode-vertex').setAttribute('aria-pressed', String(meshSubmode === 'vertex'));
  $('#mesh-submode-face').setAttribute('aria-pressed', String(meshSubmode === 'face'));
  const part = doc.parts.find(p => p.id === selectedId);
  const isMesh = part?.type === 'mesh';
  $('#face-selection-count').hidden = meshSubmode !== 'face';
  $('#face-selection-count').textContent = isMesh ? `面 ${selectedFaces.length} 個選択（選択中のパーツのみ）` : 'メッシュパーツを選択してください';
  $('#extrude-distance').hidden = meshSubmode !== 'face';
  $('#extrude-apply').hidden = meshSubmode !== 'face';
  $('#extrude-distance').disabled = !isMesh || meshSubmode !== 'face';
  $('#extrude-apply').disabled = !isMesh || !selectedFaces.length || meshSubmode !== 'face';
  $('#vertex-selection-count').hidden = meshSubmode !== 'vertex';
  $('#vertex-selection-count').textContent = isMesh ? `頂点 ${selectedVertices.length} 個選択（選択中のパーツのみ）` : 'メッシュパーツを選択してください';
  // メッシュ編集モードで未変換（箱）のパーツを選んでいるときは「メッシュに変換」を目立たせる。
  $('#convert-to-mesh').classList.toggle('attention', transformMode === 'face' && part?.type === 'box');
}
function selectFace(faceIndex, additive) {
  const part = doc.parts.find(p => p.id === selectedId);
  if (!part || part.type !== 'mesh') return;
  if (additive) {
    selectedFaces = selectedFaces.includes(faceIndex) ? selectedFaces.filter(index => index !== faceIndex) : [...selectedFaces, faceIndex];
  } else {
    selectedFaces = [faceIndex];
  }
  viewport?.setFaceSelection(selectedFaces);
  updateFaceUi();
  status(`${part.name}：面 ${selectedFaces.length} 個を選択中。`);
}
function extrudeSelectedFaces() {
  const part = doc.parts.find(p => p.id === selectedId);
  if (!part || part.type !== 'mesh' || !selectedFaces.length) return;
  const distance = Math.round(Number($('#extrude-distance').value));
  if (!Number.isFinite(distance) || distance === 0) { status('押し出す距離を0以外の整数で指定してください。', true); return; }
  execute({ type: 'extrudeFace', partId: part.id, faces: [...selectedFaces], distance }, part.id, '面を押し出しました。');
}
function selectVertex(vertexIndex, additive) {
  const part = doc.parts.find(p => p.id === selectedId);
  if (!part || part.type !== 'mesh') return;
  if (vertexIndex === null) {
    selectedVertices = [];
  } else if (additive) {
    selectedVertices = selectedVertices.includes(vertexIndex) ? selectedVertices.filter(index => index !== vertexIndex) : [...selectedVertices, vertexIndex];
  } else {
    selectedVertices = [vertexIndex];
  }
  viewport?.setVertexSelection(selectedVertices);
  updateFaceUi();
  status(selectedVertices.length ? `${part.name}：頂点 ${selectedVertices.length} 個を選択中。` : `${part.name}：頂点の選択を解除しました。`);
}
function commitMoveVertices(partId, vertexIndices, delta) {
  if (!Array.isArray(delta) || delta.every(value => value === 0)) return;
  execute({ type: 'moveVertices', partId, vertexIndices, delta }, partId, '頂点を移動しました。');
}
function setMeshSubmode(submode) {
  if (!['vertex', 'face'].includes(submode)) return;
  meshSubmode = submode;
  viewport?.setMeshSubmode(submode);
  updateFaceUi();
  updateViewHelp();
  status(faceModeStatusMessage());
}
function previewTransform(partId, transform) {
  if (partId !== selectedId) return;
  for (const [key, value] of Object.entries(transform)) {
    if (Array.isArray(value)) document.querySelectorAll(`[data-vector="${key}"]`).forEach(input => { input.value = value[Number(input.dataset.axis)]; });
    else document.querySelectorAll(`[data-scalar="${key}"]`).forEach(input => { input.value = value; });
  }
}
function previewBoneTransform(boneId, transform) {
  if (boneId !== selectedBoneId) return;
  for (const [key, value] of Object.entries(transform)) {
    document.querySelectorAll(`[data-bone-vector="${key}"]`).forEach(input => { input.value = value[Number(input.dataset.axis)]; });
  }
}
function execute(command, nextSelection = selectedId, successMessage = null) {
  try {
    if (playing) stopPlayback();
    let pixelsLost = false;
    if (command.type === 'setTransform') {
      const original = doc.parts.find(part => part.id === command.partId);
      if (original?.texture) {
        const preview = structuredClone(original);
        Object.assign(preview, structuredClone(command.transform));
        pixelsLost = resizePartTexture(preview, doc.texelsPerUnit);
      }
    } else if (command.type === 'extrudeFace') {
      const original = doc.parts.find(part => part.id === command.partId);
      if (original?.type === 'mesh' && command.distance !== 0) {
        pixelsLost = extrudeMeshFace(original, command.faces, command.distance, doc.texelsPerUnit).pixelsLost;
      }
    } else if (command.type === 'moveVertices') {
      const original = doc.parts.find(part => part.id === command.partId);
      if (original?.type === 'mesh' && Array.isArray(command.delta) && command.delta.some(value => value !== 0)) {
        pixelsLost = moveMeshVertices(original, command.vertexIndices, command.delta, doc.texelsPerUnit).pixelsLost;
      }
    } else if (command.type === 'convertToMesh') {
      const original = doc.parts.find(part => part.id === command.partId);
      if (original && original.type !== 'mesh') pixelsLost = convertPartToMesh(original, doc.texelsPerUnit).pixelsLost;
    } else if (command.type === 'weldVertices') {
      const original = doc.parts.find(part => part.id === command.partId);
      if (original?.type === 'mesh') pixelsLost = weldVertices(original, command.threshold, doc.texelsPerUnit).pixelsLost;
    }
    doc = history.execute(doc, command); selectedId = nextSelection; selectedIds = nextSelection ? [nextSelection] : []; refresh();
    const lostMessage = command.type === 'extrudeFace' ? '面の構成変更により、一部のテクスチャ内容が失われました。'
      : command.type === 'moveVertices' ? '頂点移動で面のサイズが変わり、一部のテクスチャ内容が失われました。'
        : command.type === 'convertToMesh' ? 'メッシュへの変換でテクスチャ内容が失われました（新しいメッシュは無地から塗り直してください）。'
          : command.type === 'weldVertices' ? '頂点の統合で面のサイズが変わり、一部のテクスチャ内容が失われました。'
            : 'サイズ縮小により、転写範囲外のテクスチャ内容が消えました。';
    status(pixelsLost ? lostMessage : (successMessage ?? '変更しました。JSON保存で作品を保存できます。'));
  }
  catch (error) { refresh(); status(error.message, true); }
}
// 結合前に、未変換パーツをすべてメッシュ化した場合の頂点・面の合計を見積もり、多すぎれば確認/拒否する。
// ボーンが混在している場合も確認する（続行すると1つ目のパーツのボーンへ統一される）。
// 実際の結合はmodel.jsのmergeParts（コマンドと同じ関数）を先に計算してメッセージを作り、
// 本適用はhistory.execute経由のmergePartsコマンドで行う（extrudeFace等と同じ「プレビュー先読み」の作法）。
function mergeSelectedParts() {
  if (selectedIds.length < 2) return;
  const parts = selectedIds.map(id => doc.parts.find(candidate => candidate.id === id)).filter(Boolean);
  if (parts.length < 2) return;
  let totalVertices = 0, totalFaces = 0;
  for (const part of parts) {
    const estimate = estimateMeshConversion(part);
    totalVertices += estimate.vertices; totalFaces += estimate.faces;
  }
  if (totalVertices > 2000 || totalFaces > 2000) {
    status(`結合すると頂点 約${totalVertices}個・面 約${totalFaces}個になり、上限（2000）を超えるため結合できません。分割数を減らすか、パーツを分けて結合してください。`, true);
    return;
  }
  if ((totalVertices > 300 || totalFaces > 300) && !confirm(`結合すると頂点 約${totalVertices}個・面 約${totalFaces}個になります。続けますか？`)) return;
  const boneIds = new Set(parts.map(part => part.bone));
  if (boneIds.size > 1 && !confirm('選択したパーツには異なるボーンが割り当てられています。結合すると1つ目のパーツのボーンに統一されます。続けますか？')) return;
  try {
    if (playing) stopPlayback();
    const preview = mergeParts(doc, selectedIds, doc.texelsPerUnit);
    const beforeIds = new Set(doc.parts.map(p => p.id));
    doc = history.execute(doc, { type: 'mergeParts', partIds: [...selectedIds] });
    const mergedPart = doc.parts.find(p => !beforeIds.has(p.id));
    applySelection(mergedPart ? [mergedPart.id] : []);
    const notes = [];
    if (preview.shapeRounded) notes.push('回転の影響で頂点座標を整数に丸めたため、形状がわずかに変わっている場合があります');
    if (preview.textureSkipped) notes.push('一部のテクスチャは転写しきれず、パーツ色で塗りつぶしました');
    status(`${parts.length}個のパーツを結合しました。${notes.length ? notes.join('。') + '。' : ''}`);
  } catch (error) { refresh(); status(error.message, true); }
}
// 溶接：選択中のmeshパーツ内の近い頂点を統合する。面が実際に繋がるため、ボーンで曲げたときに
// 割れなくなる代わりに、統合した範囲は1つの塊として一緒に動くことをステータスで伝える。
function weldSelectedPart() {
  const part = doc.parts.find(p => p.id === selectedId);
  if (!part || part.type !== 'mesh') return;
  const threshold = Number($('#weld-threshold').value);
  if (!Number.isFinite(threshold) || threshold < 0) { status('しきい値は0以上の数値にしてください。', true); return; }
  if (!confirm(`${part.name} の頂点を溶接します。距離${threshold}以内の頂点が1つに統合され、面が本当に繋がります（ボーンで曲げても割れなくなる代わりに、統合した範囲は1つの塊として一緒に動きます）。よろしいですか？`)) return;
  execute({ type: 'weldVertices', partId: part.id, threshold }, part.id, `${part.name} の頂点を溶接しました。`);
}
function hasPartCapacity() {
  if (doc.parts.length < 1000) return true;
  status('パーツ数の上限（1000個）に達しています。', true);
  return false;
}
function duplicateSelected(mirror = false) {
  const source = doc.parts.find(part => part.id === selectedId);
  if (!source || !hasPartCapacity()) return;
  if (mirror && source.position[0] === 0) {
    status('中心にあるパーツはミラーできません');
    return;
  }
  const part = mirror ? mirrorPart(doc, source) : duplicatePart(doc, source);
  execute(
    { type: 'addPart', part },
    part.id,
    mirror ? `${part.name} を作りました` : `${source.name} を複製しました`,
  );
}
function commitTransform(partId, transform) {
  const part = doc.parts.find(candidate => candidate.id === partId);
  if (!part) return;
  const changed = Object.entries(transform).some(([key, value]) => Array.isArray(value)
    ? value.some((item, index) => item !== part[key][index])
    : value !== part[key]);
  if (!changed) return;
  execute({ type: 'setTransform', partId, transform });
}
function commitBoneTransform(boneId, transform) {
  const bone = doc.bones.find(candidate => candidate.id === boneId);
  if (!bone) return;
  const changed = Object.entries(transform).some(([key, value]) => value.some((item, index) => item !== bone[key][index]));
  if (changed) execute({ type: 'setBoneTransform', boneId, transform });
}
function updateViewHelp() {
  $('#view-help').textContent = transformMode === 'paint'
    ? '左ドラッグ：描く　／　右クリック：スポイト　／　右ドラッグ：回転　／　中ドラッグ：移動　／　ホイール：ズーム　／　Alt＋クリック：スポイト'
    : transformMode === 'bone'
      ? 'ボーンをクリックして選択　／　W：ボーン移動　／　E：ボーン回転（15度）　／　B：ボーン表示を終了'
      : transformMode === 'animation'
        ? 'ボーンを選択して回転　／　タイムラインをドラッグ：フレーム移動　／　Space：再生・停止　／　A：アニメ表示を終了'
        : transformMode === 'face'
          ? (meshSubmode === 'vertex'
            ? '頂点をクリックして選択（Shift＋クリックで複数選択）　／　ギズモで1グリッド単位に移動　／　1：頂点　／　2：面　／　F：メッシュ編集を終了'
            : '面をクリックして選択（Shift＋クリックで複数選択）　／　距離を指定して押し出す　／　1：頂点　／　2：面　／　F：メッシュ編集を終了')
      : '左ドラッグ：回転　／　右ドラッグ：移動　／　ホイール：ズーム　／　W：移動　／　E：回転　／　R：リサイズ　／　P：ペイント　／　B：ボーン　／　F：メッシュ編集';
}
function setTransformMode(mode) {
  if (playing && mode !== 'animation') stopPlayback();
  transformMode = mode;
  if (mode === 'animation' && !activeAnimation()) {
    doc = history.execute(doc, { type: 'addAnimation', animation: { id: 'a1', name: 'animation', fps: 12, length: 12, tracks: [] } });
    currentFrame = 0;
  }
  viewport?.setMode(mode);
  $('#mode-translate').setAttribute('aria-pressed', String(mode === 'translate'));
  $('#mode-rotate').setAttribute('aria-pressed', String(mode === 'rotate'));
  $('#mode-resize').setAttribute('aria-pressed', String(mode === 'resize'));
  $('#mode-paint').setAttribute('aria-pressed', String(mode === 'paint'));
  $('#mode-bone').setAttribute('aria-pressed', String(mode === 'bone'));
  $('#mode-animation').setAttribute('aria-pressed', String(mode === 'animation'));
  $('#mode-face').setAttribute('aria-pressed', String(mode === 'face'));
  $('#bones-section').hidden = !['bone', 'animation'].includes(mode);
  $('#timeline').hidden = mode !== 'animation';
  updateFaceUi();
  updateViewHelp();
  if (mode === 'resize') status('面をドラッグしてサイズを変えます。');
  else if (mode === 'paint') status('モデルを左ドラッグして1ドットずつ描きます。');
  else if (mode === 'bone') status('ボーンを選択して、移動または回転します。');
  else if (mode === 'animation') {
    renderTimeline();
    $('#undo').disabled = !history.past.length;
    setCurrentFrame(currentFrame);
    status('タイムラインでFKアニメーションを編集・再生します。');
  }
  else if (mode === 'face') {
    viewport?.setMeshSubmode(meshSubmode);
    status(faceModeStatusMessage());
  }
  else status(mode === 'translate' ? '移動ギズモでパーツを移動します。' : '回転ギズモでパーツを回転します。');
}
// 変換前に頂点・面数を見積もり、多すぎる場合は確認またはエラーにする（曲面プリミティブは
// 分割数次第で頂点・面が非常に多くなるため）。確認して進める場合はconvertToMeshコマンドを発行する。
function requestConvertToMesh(part) {
  const estimate = estimateMeshConversion(part);
  if (estimate.vertices > 2000 || estimate.faces > 2000) {
    status(`頂点 約${estimate.vertices}個・面 約${estimate.faces}個になり、上限（2000）を超えるため変換できません。分割数を減らしてください。`, true);
    return false;
  }
  if ((estimate.vertices > 300 || estimate.faces > 300) && !confirm(`頂点 ${estimate.vertices} 個・面 ${estimate.faces} 個になります。続けますか？`)) return false;
  execute({ type: 'convertToMesh', partId: part.id }, part.id, `${part.name} をメッシュに変換しました。`);
  return true;
}
// メッシュ編集モードへ入る前に、選択中パーツが未変換ならメッシュへ変換するか確認する。
// 「いいえ」の場合はモードへ入らず、既存のモードのままにする（原因1の対策）。
function requestFaceMode() {
  if (transformMode === 'face') { setTransformMode('translate'); return; }
  const part = doc.parts.find(p => p.id === selectedId);
  if (part && part.type !== 'mesh') {
    if (!confirm(`${part.name} は${partTypeLabel(part)}です。メッシュに変換しますか？`)) return;
    if (!requestConvertToMesh(part)) return;
  }
  setTransformMode('face');
}
$('#mode-translate').addEventListener('click', () => setTransformMode('translate'));
$('#mode-rotate').addEventListener('click', () => setTransformMode('rotate'));
$('#mode-resize').addEventListener('click', () => setTransformMode('resize'));
$('#mode-paint').addEventListener('click', () => setTransformMode('paint'));
$('#mode-bone').addEventListener('click', () => setTransformMode('bone'));
$('#mode-animation').addEventListener('click', () => setTransformMode(transformMode === 'animation' ? 'translate' : 'animation'));
$('#mode-face').addEventListener('click', requestFaceMode);
$('#extrude-apply').addEventListener('click', extrudeSelectedFaces);
$('#mesh-submode-vertex').addEventListener('click', () => setMeshSubmode('vertex'));
$('#mesh-submode-face').addEventListener('click', () => setMeshSubmode('face'));
function updateOutlineSettings() {
  const depthThreshold = Number($('#outline-depth').value);
  const normalThreshold = Number($('#outline-normal').value);
  for (const button of document.querySelectorAll('[data-outline-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.outlineMode === outlineMode));
  }
  $('#outline-depth-value').value = depthThreshold.toFixed(3);
  $('#outline-normal-value').value = normalThreshold.toFixed(2);
  $('#outline-depth').disabled = outlineMode !== 'edge';
  $('#outline-normal').disabled = outlineMode !== 'edge';
  viewport?.setOutlineSettings({ mode: outlineMode, depthThreshold, normalThreshold });
}
for (const button of document.querySelectorAll('[data-outline-mode]')) button.addEventListener('click', () => {
  outlineMode = button.dataset.outlineMode;
  updateOutlineSettings();
});
$('#outline-depth').addEventListener('input', updateOutlineSettings);
$('#outline-normal').addEventListener('input', updateOutlineSettings);
$('#animation-play').addEventListener('click', () => playing ? stopPlayback() : startPlayback());
$('#animation-prev').addEventListener('click', () => { stopPlayback(); setCurrentFrame(currentFrame - 1); });
$('#animation-next').addEventListener('click', () => { stopPlayback(); setCurrentFrame(currentFrame + 1); });
$('#animation-set-key').addEventListener('click', () => {
  const animation = activeAnimation(), bone = doc.bones.find(candidate => candidate.id === selectedBoneId);
  if (!animation || !bone) return;
  execute({ type: 'setKeyframe', animationId: animation.id, boneId: bone.id, frame: currentFrame, rotation: bone.rotation }, selectedId, `${bone.name} のフレーム ${currentFrame} にキーを打ちました。`);
});
$('#animation-remove-key').addEventListener('click', () => {
  const animation = activeAnimation(), bone = doc.bones.find(candidate => candidate.id === selectedBoneId);
  if (!animation || !bone) return;
  execute({ type: 'removeKeyframe', animationId: animation.id, boneId: bone.id, frame: currentFrame }, selectedId, `${bone.name} のフレーム ${currentFrame} のキーを削除しました。`);
  setCurrentFrame(currentFrame);
});
for (const [selector, property] of [['#animation-length', 'length'], ['#animation-fps', 'fps']]) $(selector).addEventListener('change', event => {
  const input = event.target, animation = activeAnimation();
  if (!animation) return;
  if (!input.checkValidity()) { input.reportValidity(); refresh(); return; }
  execute({ type: 'setClipSettings', animationId: animation.id, [property]: Number(input.value) });
  currentFrame = Math.min(currentFrame, (activeAnimation()?.length ?? 1) - 1);
  setCurrentFrame(currentFrame);
});
const timelineScroll = $('#timeline-scroll');
timelineScroll.addEventListener('pointerdown', event => {
  const cell = event.target.closest('.timeline-cell');
  if (!cell || event.button !== 0) return;
  stopPlayback(); timelineDragging = true; timelineScroll.setPointerCapture(event.pointerId);
  setCurrentFrame(Number(cell.dataset.frame)); event.preventDefault();
});
timelineScroll.addEventListener('pointermove', event => {
  if (!timelineDragging || !timelineScroll.hasPointerCapture(event.pointerId)) return;
  const rect = $('#timeline-grid').getBoundingClientRect();
  setCurrentFrame(Math.floor((event.clientX - rect.left - 110) / 24));
});
const finishTimelineDrag = event => {
  if (!timelineDragging) return;
  timelineDragging = false;
  if (timelineScroll.hasPointerCapture(event.pointerId)) timelineScroll.releasePointerCapture(event.pointerId);
};
timelineScroll.addEventListener('pointerup', finishTimelineDrag);
timelineScroll.addEventListener('pointercancel', finishTimelineDrag);
function setBoneTool(tool) {
  boneTool = tool; viewport?.setBoneTool(tool);
  $('#bone-move').setAttribute('aria-pressed', String(tool === 'translate'));
  $('#bone-rotate').setAttribute('aria-pressed', String(tool === 'rotate'));
  status(tool === 'translate' ? 'ボーンを1グリッド単位で移動します。' : 'ボーンを15度単位で回転します。');
}
$('#bone-move').addEventListener('click', () => setBoneTool('translate'));
$('#bone-rotate').addEventListener('click', () => setBoneTool('rotate'));
function updatePaintUi() {
  const color = doc.palette[paintColorIndex];
  $('#paint-color').style.backgroundColor = color;
  $('#paint-color-value').textContent = color;
  document.querySelectorAll('#palette button').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.index) === paintColorIndex)));
  for (const tool of ['pen', 'eraser', 'eyedropper']) $(`#paint-${tool}`).setAttribute('aria-pressed', String(paintTool === tool));
  viewport?.setPaintSettings(paintTool, PALETTE_CHARS[paintColorIndex]);
}
function setPaintColor(index) {
  paintColorIndex = index;
  updatePaintUi();
  status(`描画色を ${doc.palette[index]} にしました。`);
}
function setPaintTool(tool) {
  paintTool = tool; updatePaintUi();
  status({ pen: 'ペンで現在色を描きます。', eraser: '消しゴムでパーツ色へ戻します。', eyedropper: 'モデル上の色をクリックして取得します。' }[tool]);
}
for (const tool of ['pen', 'eraser', 'eyedropper']) $(`#paint-${tool}`).addEventListener('click', () => setPaintTool(tool));
function samplePaintColor(partId, character) {
  const part = doc.parts.find(candidate => candidate.id === partId);
  if (!part) return;
  if (character === '.') {
    paintTool = 'eraser';
    updatePaintUi();
    status('未指定色を取得しました。消しゴムに切り替えます。');
    return;
  }
  paintColorIndex = PALETTE_CHARS.indexOf(character);
  if (paintTool === 'eraser') paintTool = 'pen';
  updatePaintUi(); status(`スポイトで ${doc.palette[paintColorIndex]} を取得しました。`);
}
function showPaintHover(hit) {
  if (transformMode !== 'paint') return;
  if (!hit) { status('モデルを左ドラッグして1ドットずつ描きます。'); return; }
  const part = doc.parts.find(candidate => candidate.id === hit.partId);
  if (part) status(`${part.name} (${hit.x}, ${hit.y})`);
}
document.addEventListener('keydown', event => {
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
    event.preventDefault();
    duplicateSelected();
  } else if (event.code === 'Space' && transformMode === 'animation') { event.preventDefault(); playing ? stopPlayback() : startPlayback(); }
  else if (event.key.toLowerCase() === 'a') setTransformMode(transformMode === 'animation' ? 'translate' : 'animation');
  else if (event.key.toLowerCase() === 'w') transformMode === 'bone' ? setBoneTool('translate') : transformMode !== 'animation' && setTransformMode('translate');
  else if (event.key.toLowerCase() === 'e') ['bone', 'animation'].includes(transformMode) ? setBoneTool('rotate') : setTransformMode('rotate');
  else if (event.key.toLowerCase() === 'r') setTransformMode('resize');
  else if (event.key.toLowerCase() === 'p') setTransformMode('paint');
  else if (event.key.toLowerCase() === 'b') setTransformMode(transformMode === 'bone' ? 'translate' : 'bone');
  else if (event.key.toLowerCase() === 'f') requestFaceMode();
  else if (transformMode === 'face' && event.key === '1') setMeshSubmode('vertex');
  else if (transformMode === 'face' && event.key === '2') setMeshSubmode('face');
});
for (const [id, type] of [['#add-box', 'box'], ['#add-cylinder', 'cylinder']]) $(id).addEventListener('click', () => {
  if (!hasPartCapacity()) return;
  const part = createPart(doc, type); execute({ type: 'addPart', part }, part.id);
});
$('#add-primitive').addEventListener('click', () => {
  if (!hasPartCapacity()) return;
  const part = createPart(doc, $('#add-primitive-type').value); execute({ type: 'addPart', part }, part.id);
});
$('#duplicate').addEventListener('click', () => duplicateSelected());
$('#mirror').addEventListener('click', () => duplicateSelected(true));
$('#convert-to-mesh').addEventListener('click', () => {
  const part = doc.parts.find(p => p.id === selectedId);
  if (!part) return;
  requestConvertToMesh(part);
});
$('#weld-vertices').addEventListener('click', weldSelectedPart);
$('#merge-parts').addEventListener('click', mergeSelectedParts);
$('#delete').addEventListener('click', () => execute({ type: 'removePart', partId: selectedId }, null));
$('#add-bone').addEventListener('click', () => {
  const bone = createBone(doc, selectedBoneId);
  selectedBoneId = bone.id;
  execute({ type: 'addBone', bone }, selectedId, `${bone.name} を追加しました。`);
});
$('#remove-bone').addEventListener('click', () => {
  const bone = doc.bones.find(candidate => candidate.id === selectedBoneId);
  if (!bone) return;
  const descendants = boneDescendants(bone.id);
  const message = descendants.size
    ? `${bone.name} と子ボーン ${descendants.size} 本を削除します。所属パーツは「なし」に戻ります。よろしいですか？`
    : `${bone.name} を削除します。所属パーツは「なし」に戻ります。よろしいですか？`;
  if (!confirm(message)) return;
  const parent = bone.parent; execute({ type: 'removeBone', boneId: bone.id }); selectedBoneId = parent; refresh();
});
$('#undo').addEventListener('click', () => { stopPlayback(); doc = history.undo(doc); currentFrame = Math.min(currentFrame, (activeAnimation()?.length ?? 1) - 1); if (transformMode === 'animation' && activeAnimation()) doc = applyAnimationFrame(doc, activeAnimation().id, currentFrame, THREE); refresh(); status('元に戻しました。'); });
$('#redo').addEventListener('click', () => { stopPlayback(); doc = history.redo(doc); currentFrame = Math.min(currentFrame, (activeAnimation()?.length ?? 1) - 1); if (transformMode === 'animation' && activeAnimation()) doc = applyAnimationFrame(doc, activeAnimation().id, currentFrame, THREE); refresh(); status('やり直しました。'); });
function switchSample(sample) {
  if (!confirm('編集中の内容は失われます。よろしいですか？')) return;
  const samples = {
    new: [createNewDoc, '新規'],
    human: [createSampleDoc, '人型'],
    chest: [createChestSampleDoc, '宝箱'],
    teapot: [createTeapotSampleDoc, 'ティーポット'],
  };
  const [createDoc, label] = samples[sample];
  stopPlayback(); doc = createDoc(); currentFrame = 0;
  activeSample = sample;
  history.reset();
  selectedId = doc.parts[0]?.id ?? null;
  selectedIds = selectedId ? [selectedId] : [];
  selectedBoneId = null;
  refresh();
  status(sample === 'new' ? '新規モデルを作成しました。' : `${label}サンプルに切り替えました。`);
}
$('#sample-new').addEventListener('click', () => switchSample('new'));
$('#sample-human').addEventListener('click', () => switchSample('human'));
$('#sample-chest').addEventListener('click', () => switchSample('chest'));
$('#sample-teapot').addEventListener('click', () => switchSample('teapot'));
$('#properties-form').addEventListener('submit', event => event.preventDefault());
$('#properties-form').addEventListener('change', event => {
  const input = event.target, part = doc.parts.find(p => p.id === selectedId);
  if (!part) return;
  if (!input.checkValidity()) { input.reportValidity(); refresh(); status('入力値を確認してください。数値は整数のみです。', true); return; }
  if (input.id === 'part-name') execute({ type: 'rename', partId: part.id, name: input.value });
  else if (input.id === 'part-color') execute({ type: 'setColor', partId: part.id, color: input.value });
  else if (input.id === 'part-bone') execute({ type: 'assignPartBone', partId: part.id, boneId: input.value || null });
  else if (input.dataset.vector) {
    const key = input.dataset.vector;
    if (!Array.isArray(part[key])) { refresh(); return; }
    const value = [...part[key]]; value[Number(input.dataset.axis)] = Number(input.value);
    execute({ type: 'setTransform', partId: part.id, transform: { [key]: value } });
  } else if (input.dataset.scalar) execute({ type: 'setTransform', partId: part.id, transform: { [input.dataset.scalar]: Number(input.value) } });
});
$('#bone-properties-form').addEventListener('submit', event => event.preventDefault());
$('#bone-properties-form').addEventListener('change', event => {
  const input = event.target, bone = doc.bones.find(candidate => candidate.id === selectedBoneId);
  if (!bone) return;
  if (!input.checkValidity()) { input.reportValidity(); refresh(); status('ボーンの入力値を確認してください。数値は整数のみです。', true); return; }
  if (input.id === 'bone-name') execute({ type: 'renameBone', boneId: bone.id, name: input.value });
  else if (input.id === 'bone-parent') execute({ type: 'setBoneParent', boneId: bone.id, parent: input.value || null });
  else if (input.dataset.boneVector) {
    const key = input.dataset.boneVector, value = [...bone[key]]; value[Number(input.dataset.axis)] = Number(input.value);
    execute({ type: 'setBoneTransform', boneId: bone.id, transform: { [key]: value } });
  }
});
$('#save').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([serializeDoc(doc)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `${doc.name.replace(/[\\/:*?"<>|]/g, '_')}.json`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); status('JSONを保存しました。');
});
$('#load').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('JSONは5MB以下にしてください。');
    const loaded = deserializeDoc(await file.text());
    // 読込は別ドキュメントへの切替。編集履歴を持ち越さない。
    stopPlayback(); doc = loaded; currentFrame = 0; activeSample = null; history.reset(); selectedId = doc.parts[0]?.id ?? null; selectedIds = selectedId ? [selectedId] : []; selectedBoneId = null; refresh(); status(`${file.name}を読み込みました。`);
  } catch (error) { status(`読込できませんでした：${error.message}`, true); }
  finally { event.target.value = ''; }
});
function applyBridgeCommands(commands) {
  if (playing) stopPlayback();
  doc = history.executeBatch(doc, commands);
  activeSample = null;
  currentFrame = Math.min(currentFrame, (activeAnimation()?.length ?? 1) - 1);
  refresh(); status(`MCPから${commands.length}件のコマンドを適用しました。`);
  return { applied: commands.length, model: cloneDoc(doc) };
}
function replaceFromBridge(model) {
  if (playing) stopPlayback();
  doc = history.replace(doc, model);
  activeSample = null; currentFrame = 0;
  selectedId = doc.parts[0]?.id ?? null; selectedIds = selectedId ? [selectedId] : []; selectedBoneId = null;
  refresh(); status('MCPからモデル全体を差し替えました。');
  return { model: cloneDoc(doc) };
}
function renderBridgePreview(args) {
  let previewDoc = null;
  if (args.frame !== undefined) {
    if (!Number.isSafeInteger(args.frame)) throw new Error('frameは整数で指定してください。');
    const animation = args.animationId
      ? doc.animations?.find(candidate => candidate.id === args.animationId)
      : activeAnimation();
    if (!animation) throw new Error('プレビュー対象のアニメーションが見つかりません。');
    if (args.frame < 0 || args.frame >= animation.length) throw new Error(`frameは0〜${animation.length - 1}で指定してください。`);
    previewDoc = applyAnimationFrame(doc, animation.id, args.frame, THREE);
  }
  return { base64: viewport.renderPreview(args, previewDoc), width: 384, height: 216 };
}
try {
  viewport = createViewport($('#viewport'), $('#canvas-host'), select, commitTransform, previewTransform, {
    onCommitPaint: command => execute(command, command.partId, 'ペイントしました。'),
    onHoverPaint: showPaintHover,
    onSamplePaint: samplePaintColor,
    onPreviewPaint: previewPaintPixels,
    onSelectBone: id => { selectedBoneId = id; refresh(); },
    onBoneTransformCommit: commitBoneTransform,
    onBoneTransformPreview: previewBoneTransform,
    onSelectFace: selectFace,
    onSelectVertex: selectVertex,
    onMoveVertices: commitMoveVertices,
  });
  setTransformMode(transformMode); setBoneTool(boneTool); viewport?.setMeshSubmode(meshSubmode); updateOutlineSettings(); refresh();
  connectMcpBridge({
    get_model: () => cloneDoc(doc),
    apply_commands: args => applyBridgeCommands(args.commands),
    create_from_spec: args => replaceFromBridge(args.model),
    validate_model: () => validateModelReport(doc),
    render_preview: renderBridgePreview,
  }, $('#mcp-status'));
}
catch (error) {
  // 部分初期化された viewport で同じ描画エラーを再発させない。
  viewport = undefined;
  refresh();
  status(`3D表示を開始できませんでした：${error.message}`, true);
}
