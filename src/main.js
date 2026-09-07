import { PALETTE_CHARS, createSampleDoc, createChestSampleDoc, createTeapotSampleDoc, createPart, createBone, duplicatePart, mirrorPart, resizePartTexture, serializeDoc, deserializeDoc, textureLayout } from './model.js';
import { CommandHistory } from './commands.js';
import { createViewport } from './viewport.js';
const $ = selector => document.querySelector(selector);
let doc = createSampleDoc();
// 選択は一時的なUI状態。モデルの編集状態はdocのみに置く。
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
const status = (message, error = false) => {
  $('#status').textContent = message;
  $('#status').classList.toggle('error', error);
};
function refresh() {
  if (!doc.parts.some(p => p.id === selectedId)) selectedId = null;
  if (!doc.bones.some(bone => bone.id === selectedBoneId)) selectedBoneId = null;
  viewport?.rebuild(doc, selectedId, selectedBoneId);
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
  $('#sample-teapot').setAttribute('aria-pressed', String(activeSample === 'teapot'));
  $('#properties-form').hidden = !part; $('#empty-selection').hidden = !!part;
  $('#part-type').textContent = part ? (part.type === 'box' ? '箱' : '円柱') : '';
  $('#uv-preview-section').hidden = !part;
  $('#bones-section').hidden = transformMode !== 'bone';
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
  $('#part-bone').replaceChildren(new Option('なし', ''), ...doc.bones.map(candidate => new Option(candidate.name, candidate.id)));
  if (!part) return;
  $('#part-name').value = part.name;
  $('#part-bone').value = part.bone ?? '';
  $('#part-color').value = part.color; $('#color-value').textContent = part.color;
  $('#box-fields').hidden = part.type !== 'box'; $('#box-fields').disabled = part.type !== 'box';
  $('#cylinder-fields').hidden = part.type !== 'cylinder'; $('#cylinder-fields').disabled = part.type !== 'cylinder';
  document.querySelectorAll('[data-vector]').forEach(input => { input.value = part[input.dataset.vector][Number(input.dataset.axis)]; });
  document.querySelectorAll('[data-scalar]').forEach(input => { input.value = part[input.dataset.scalar]; });
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
function previewBoneTransform(boneId, transform) {
  if (boneId !== selectedBoneId) return;
  for (const [key, value] of Object.entries(transform)) {
    document.querySelectorAll(`[data-bone-vector="${key}"]`).forEach(input => { input.value = value[Number(input.dataset.axis)]; });
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
function commitBoneTransform(boneId, transform) {
  const bone = doc.bones.find(candidate => candidate.id === boneId);
  if (!bone) return;
  const changed = Object.entries(transform).some(([key, value]) => value.some((item, index) => item !== bone[key][index]));
  if (changed) execute({ type: 'setBoneTransform', boneId, transform });
}
function setTransformMode(mode) {
  transformMode = mode;
  viewport?.setMode(mode);
  $('#mode-translate').setAttribute('aria-pressed', String(mode === 'translate'));
  $('#mode-rotate').setAttribute('aria-pressed', String(mode === 'rotate'));
  $('#mode-resize').setAttribute('aria-pressed', String(mode === 'resize'));
  $('#mode-paint').setAttribute('aria-pressed', String(mode === 'paint'));
  $('#mode-bone').setAttribute('aria-pressed', String(mode === 'bone'));
  $('#bones-section').hidden = mode !== 'bone';
  $('#view-help').textContent = mode === 'paint'
    ? '左ドラッグ：描く　／　右クリック：スポイト　／　右ドラッグ：回転　／　中ドラッグ：移動　／　ホイール：ズーム　／　Alt＋クリック：スポイト'
    : mode === 'bone'
      ? 'ボーンをクリックして選択　／　W：ボーン移動　／　E：ボーン回転（15度）　／　B：ボーン表示を終了'
      : '左ドラッグ：回転　／　右ドラッグ：移動　／　ホイール：ズーム　／　W：移動　／　E：回転　／　R：リサイズ　／　P：ペイント　／　B：ボーン';
  if (mode === 'resize') status('面をドラッグしてサイズを変えます。');
  else if (mode === 'paint') status('モデルを左ドラッグして1ドットずつ描きます。');
  else if (mode === 'bone') status('ボーンを選択して、移動または回転します。');
  else status(mode === 'translate' ? '移動ギズモでパーツを移動します。' : '回転ギズモでパーツを回転します。');
}
$('#mode-translate').addEventListener('click', () => setTransformMode('translate'));
$('#mode-rotate').addEventListener('click', () => setTransformMode('rotate'));
$('#mode-resize').addEventListener('click', () => setTransformMode('resize'));
$('#mode-paint').addEventListener('click', () => setTransformMode('paint'));
$('#mode-bone').addEventListener('click', () => setTransformMode('bone'));
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
  } else if (event.key.toLowerCase() === 'w') transformMode === 'bone' ? setBoneTool('translate') : setTransformMode('translate');
  else if (event.key.toLowerCase() === 'e') transformMode === 'bone' ? setBoneTool('rotate') : setTransformMode('rotate');
  else if (event.key.toLowerCase() === 'r') setTransformMode('resize');
  else if (event.key.toLowerCase() === 'p') setTransformMode('paint');
  else if (event.key.toLowerCase() === 'b') setTransformMode(transformMode === 'bone' ? 'translate' : 'bone');
});
for (const [id, type] of [['#add-box', 'box'], ['#add-cylinder', 'cylinder']]) $(id).addEventListener('click', () => {
  if (!hasPartCapacity()) return;
  const part = createPart(doc, type); execute({ type: 'addPart', part }, part.id);
});
$('#duplicate').addEventListener('click', () => duplicateSelected());
$('#mirror').addEventListener('click', () => duplicateSelected(true));
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
$('#undo').addEventListener('click', () => { doc = history.undo(doc); refresh(); status('元に戻しました。'); });
$('#redo').addEventListener('click', () => { doc = history.redo(doc); refresh(); status('やり直しました。'); });
function switchSample(sample) {
  if (!confirm('編集中の内容は失われます。よろしいですか？')) return;
  const samples = {
    human: [createSampleDoc, '人型'],
    chest: [createChestSampleDoc, '宝箱'],
    teapot: [createTeapotSampleDoc, 'ティーポット'],
  };
  const [createDoc, label] = samples[sample];
  doc = createDoc();
  activeSample = sample;
  history.reset();
  selectedId = doc.parts[0]?.id ?? null;
  selectedBoneId = null;
  refresh();
  status(`${label}サンプルに切り替えました。`);
}
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
    const key = input.dataset.vector, value = [...part[key]]; value[Number(input.dataset.axis)] = Number(input.value);
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
    doc = loaded; activeSample = null; history.reset(); selectedId = doc.parts[0]?.id ?? null; selectedBoneId = null; refresh(); status(`${file.name}を読み込みました。`);
  } catch (error) { status(`読込できませんでした：${error.message}`, true); }
  finally { event.target.value = ''; }
});
try {
  viewport = createViewport($('#viewport'), $('#canvas-host'), select, commitTransform, previewTransform, {
    onCommitPaint: command => execute(command, command.partId, 'ペイントしました。'),
    onHoverPaint: showPaintHover,
    onSamplePaint: samplePaintColor,
    onPreviewPaint: previewPaintPixels,
    onSelectBone: id => { selectedBoneId = id; refresh(); },
    onBoneTransformCommit: commitBoneTransform,
    onBoneTransformPreview: previewBoneTransform,
  });
  setTransformMode(transformMode); setBoneTool(boneTool); refresh();
}
catch (error) {
  // 部分初期化された viewport で同じ描画エラーを再発させない。
  viewport = undefined;
  refresh();
  status(`3D表示を開始できませんでした：${error.message}`, true);
}
