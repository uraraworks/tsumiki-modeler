import { PALETTE_CHARS, createSampleDoc, createChestSampleDoc, createPart, duplicatePart, mirrorPart, resizePartTexture, serializeDoc, deserializeDoc, textureLayout } from './model.js';
import { CommandHistory } from './commands.js';
import { createViewport } from './viewport.js';
const $ = selector => document.querySelector(selector);
let doc = createSampleDoc();
// 選択は一時的なUI状態。モデルの編集状態はdocのみに置く。
let selectedId = 'p2';
const history = new CommandHistory();
let viewport;
let transformMode = 'translate';
let paintTool = 'pen';
let paintColorIndex = 0;
let renderedPalette = '';
let activeSample = 'human';
const status = (message, error = false) => {
  $('#status').textContent = message;
  $('#status').classList.toggle('error', error);
};
function refresh() {
  if (!doc.parts.some(p => p.id === selectedId)) selectedId = null;
  viewport?.rebuild(doc, selectedId);
  $('#part-count').textContent = `${doc.parts.length} 個`;
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
    button.type = 'button'; button.setAttribute('aria-pressed', String(part.id === selectedId));
    const swatch = document.createElement('span'); swatch.className = 'part-swatch'; swatch.style.backgroundColor = part.color;
    const name = document.createElement('span'); name.className = 'part-label'; name.textContent = part.name;
    const kind = document.createElement('span'); kind.className = 'part-kind'; kind.textContent = part.type === 'box' ? '箱' : '円柱';
    button.append(swatch, name, kind); button.addEventListener('click', () => select(part.id)); li.append(button); return li;
  }));
  const part = doc.parts.find(p => p.id === selectedId);
  $('#delete').disabled = !part;
  $('#duplicate').disabled = !part; $('#mirror').disabled = !part;
  $('#undo').disabled = !history.past.length; $('#redo').disabled = !history.future.length;
  $('#sample-human').setAttribute('aria-pressed', String(activeSample === 'human'));
  $('#sample-chest').setAttribute('aria-pressed', String(activeSample === 'chest'));
  $('#properties-form').hidden = !part; $('#empty-selection').hidden = !!part;
  $('#part-type').textContent = part ? (part.type === 'box' ? '箱' : '円柱') : '';
  $('#uv-preview-section').hidden = !part;
  if (!part) return;
  $('#part-name').value = part.name;
  $('#part-color').value = part.color; $('#color-value').textContent = part.color;
  $('#box-fields').hidden = part.type !== 'box'; $('#box-fields').disabled = part.type !== 'box';
  $('#cylinder-fields').hidden = part.type !== 'cylinder'; $('#cylinder-fields').disabled = part.type !== 'cylinder';
  document.querySelectorAll('[data-vector]').forEach(input => { input.value = part[input.dataset.vector][Number(input.dataset.axis)]; });
  document.querySelectorAll('[data-scalar]').forEach(input => { input.value = part[input.dataset.scalar]; });
  renderUvPreview(part);
}
function renderUvPreview(part) {
  const canvas = $('#uv-preview'), note = $('#uv-preview-note');
  const layout = textureLayout(part, doc.texelsPerUnit);
  const [width, height] = layout.size;
  const scale = Math.max(1, Math.min(8, Math.floor(246 / width)));
  if (width * scale > 8192 || height * scale > 8192 || width * height * scale * scale > 16000000) {
    canvas.hidden = true; note.textContent = `${width} × ${height}px（プレビューには大きすぎます）`; return;
  }
  canvas.hidden = false; note.textContent = `${width} × ${height}px · ${doc.texelsPerUnit}px/グリッド`;
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
    const left = x * scale, top = y * scale, drawnWidth = faceWidth * scale, drawnHeight = faceHeight * scale;
    if (part.type === 'cylinder' && name !== 'side') {
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
function select(id) { selectedId = id; refresh(); }
function previewTransform(partId, transform) {
  if (partId !== selectedId) return;
  for (const [key, value] of Object.entries(transform)) {
    if (Array.isArray(value)) document.querySelectorAll(`[data-vector="${key}"]`).forEach(input => { input.value = value[Number(input.dataset.axis)]; });
    else document.querySelectorAll(`[data-scalar="${key}"]`).forEach(input => { input.value = value; });
  }
}
function execute(command, nextSelection = selectedId, successMessage = null) {
  try {
    let pixelsLost = false;
    if (command.type === 'setTransform') {
      const original = doc.parts.find(part => part.id === command.partId);
      if (original?.texture) {
        const preview = structuredClone(original);
        Object.assign(preview, structuredClone(command.transform));
        pixelsLost = resizePartTexture(preview, doc.texelsPerUnit);
      }
    }
    doc = history.execute(doc, command); selectedId = nextSelection; refresh();
    status(pixelsLost ? 'サイズ縮小により、転写範囲外のテクスチャ内容が消えました。' : (successMessage ?? '変更しました。JSON保存で作品を保存できます。'));
  }
  catch (error) { refresh(); status(error.message, true); }
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
function setTransformMode(mode) {
  transformMode = mode;
  viewport?.setMode(mode);
  $('#mode-translate').setAttribute('aria-pressed', String(mode === 'translate'));
  $('#mode-rotate').setAttribute('aria-pressed', String(mode === 'rotate'));
  $('#mode-resize').setAttribute('aria-pressed', String(mode === 'resize'));
  $('#mode-paint').setAttribute('aria-pressed', String(mode === 'paint'));
  $('#view-help').textContent = mode === 'paint'
    ? '左ドラッグ：描く　／　右ドラッグ：回転　／　中ドラッグ：移動　／　ホイール：ズーム　／　Alt＋クリック：スポイト'
    : '左ドラッグ：回転　／　右ドラッグ：移動　／　ホイール：ズーム　／　W：移動　／　E：回転　／　R：リサイズ　／　P：ペイント';
  if (mode === 'resize') status('面をドラッグしてサイズを変えます。');
  else if (mode === 'paint') status('モデルを左ドラッグして1ドットずつ描きます。');
  else status(mode === 'translate' ? '移動ギズモでパーツを移動します。' : '回転ギズモでパーツを回転します。');
}
$('#mode-translate').addEventListener('click', () => setTransformMode('translate'));
$('#mode-rotate').addEventListener('click', () => setTransformMode('rotate'));
$('#mode-resize').addEventListener('click', () => setTransformMode('resize'));
$('#mode-paint').addEventListener('click', () => setTransformMode('paint'));
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
  if (character !== '.') paintColorIndex = PALETTE_CHARS.indexOf(character);
  else {
    const rgb = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
    const source = rgb(part.color);
    paintColorIndex = doc.palette.reduce((best, color, index) => {
      const candidate = rgb(color), distance = candidate.reduce((sum, value, channel) => sum + (value - source[channel]) ** 2, 0);
      return distance < best.distance ? { index, distance } : best;
    }, { index: 0, distance: Infinity }).index;
  }
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
  } else if (event.key.toLowerCase() === 'w') setTransformMode('translate');
  else if (event.key.toLowerCase() === 'e') setTransformMode('rotate');
  else if (event.key.toLowerCase() === 'r') setTransformMode('resize');
  else if (event.key.toLowerCase() === 'p') setTransformMode('paint');
});
for (const [id, type] of [['#add-box', 'box'], ['#add-cylinder', 'cylinder']]) $(id).addEventListener('click', () => {
  if (!hasPartCapacity()) return;
  const part = createPart(doc, type); execute({ type: 'addPart', part }, part.id);
});
$('#duplicate').addEventListener('click', () => duplicateSelected());
$('#mirror').addEventListener('click', () => duplicateSelected(true));
$('#delete').addEventListener('click', () => execute({ type: 'removePart', partId: selectedId }, null));
$('#undo').addEventListener('click', () => { doc = history.undo(doc); refresh(); status('元に戻しました。'); });
$('#redo').addEventListener('click', () => { doc = history.redo(doc); refresh(); status('やり直しました。'); });
function switchSample(sample) {
  if (!confirm('編集中の内容は失われます。よろしいですか？')) return;
  doc = sample === 'chest' ? createChestSampleDoc() : createSampleDoc();
  activeSample = sample;
  history.reset();
  selectedId = doc.parts[0]?.id ?? null;
  refresh();
  status(`${sample === 'chest' ? '宝箱' : '人型'}サンプルに切り替えました。`);
}
$('#sample-human').addEventListener('click', () => switchSample('human'));
$('#sample-chest').addEventListener('click', () => switchSample('chest'));
$('#properties-form').addEventListener('submit', event => event.preventDefault());
$('#properties-form').addEventListener('change', event => {
  const input = event.target, part = doc.parts.find(p => p.id === selectedId);
  if (!part) return;
  if (!input.checkValidity()) { input.reportValidity(); refresh(); status('入力値を確認してください。数値は整数のみです。', true); return; }
  if (input.id === 'part-name') execute({ type: 'rename', partId: part.id, name: input.value });
  else if (input.id === 'part-color') execute({ type: 'setColor', partId: part.id, color: input.value });
  else if (input.dataset.vector) {
    const key = input.dataset.vector, value = [...part[key]]; value[Number(input.dataset.axis)] = Number(input.value);
    execute({ type: 'setTransform', partId: part.id, transform: { [key]: value } });
  } else if (input.dataset.scalar) execute({ type: 'setTransform', partId: part.id, transform: { [input.dataset.scalar]: Number(input.value) } });
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
    doc = loaded; activeSample = null; history.reset(); selectedId = doc.parts[0]?.id ?? null; refresh(); status(`${file.name}を読み込みました。`);
  } catch (error) { status(`読込できませんでした：${error.message}`, true); }
  finally { event.target.value = ''; }
});
try {
  viewport = createViewport($('#viewport'), $('#canvas-host'), select, commitTransform, previewTransform, {
    onCommitPaint: command => execute(command, command.partId, 'ペイントしました。'),
    onHoverPaint: showPaintHover,
    onSamplePaint: samplePaintColor,
    onPreviewPaint: previewPaintPixels,
  });
  setTransformMode(transformMode); refresh();
}
catch (error) {
  // 部分初期化された viewport で同じ描画エラーを再発させない。
  viewport = undefined;
  refresh();
  status(`3D表示を開始できませんでした：${error.message}`, true);
}
