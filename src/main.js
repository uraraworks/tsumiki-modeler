import { createSampleDoc, createPart, serializeDoc, deserializeDoc } from './model.js';
import { CommandHistory } from './commands.js';
import { createViewport } from './viewport.js';
const $ = selector => document.querySelector(selector);
let doc = createSampleDoc();
// 選択は一時的なUI状態。モデルの編集状態はdocのみに置く。
let selectedId = 'p2';
const history = new CommandHistory();
let viewport;
let transformMode = 'translate';
const status = (message, error = false) => { $('#status').textContent = message; $('#status').classList.toggle('error', error); };
function refresh() {
  if (!doc.parts.some(p => p.id === selectedId)) selectedId = null;
  viewport?.rebuild(doc, selectedId);
  $('#part-count').textContent = `${doc.parts.length} 個`;
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
  $('#undo').disabled = !history.past.length; $('#redo').disabled = !history.future.length;
  $('#properties-form').hidden = !part; $('#empty-selection').hidden = !!part;
  $('#part-type').textContent = part ? (part.type === 'box' ? '箱' : '円柱') : '';
  if (!part) return;
  $('#part-name').value = part.name;
  $('#part-color').value = part.color; $('#color-value').textContent = part.color;
  $('#box-fields').hidden = part.type !== 'box'; $('#box-fields').disabled = part.type !== 'box';
  $('#cylinder-fields').hidden = part.type !== 'cylinder'; $('#cylinder-fields').disabled = part.type !== 'cylinder';
  document.querySelectorAll('[data-vector]').forEach(input => { input.value = part[input.dataset.vector][Number(input.dataset.axis)]; });
  document.querySelectorAll('[data-scalar]').forEach(input => { input.value = part[input.dataset.scalar]; });
}
function select(id) { selectedId = id; refresh(); }
function previewTransform(partId, transform) {
  if (partId !== selectedId) return;
  const [key, values] = Object.entries(transform)[0];
  document.querySelectorAll(`[data-vector="${key}"]`).forEach(input => { input.value = values[Number(input.dataset.axis)]; });
}
function execute(command, nextSelection = selectedId) {
  try { doc = history.execute(doc, command); selectedId = nextSelection; refresh(); status('変更しました。JSON保存で作品を保存できます。'); }
  catch (error) { refresh(); status(error.message, true); }
}
function commitTransform(partId, transform) {
  const part = doc.parts.find(candidate => candidate.id === partId);
  if (!part) return;
  const [key, values] = Object.entries(transform)[0];
  if (values.every((value, index) => value === part[key][index])) return;
  execute({ type: 'setTransform', partId, transform });
}
function setTransformMode(mode) {
  transformMode = mode;
  viewport?.setMode(mode);
  $('#mode-translate').setAttribute('aria-pressed', String(mode === 'translate'));
  $('#mode-rotate').setAttribute('aria-pressed', String(mode === 'rotate'));
}
$('#mode-translate').addEventListener('click', () => setTransformMode('translate'));
$('#mode-rotate').addEventListener('click', () => setTransformMode('rotate'));
document.addEventListener('keydown', event => {
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
  if (event.key.toLowerCase() === 'w') setTransformMode('translate');
  else if (event.key.toLowerCase() === 'e') setTransformMode('rotate');
});
for (const [id, type] of [['#add-box', 'box'], ['#add-cylinder', 'cylinder']]) $(id).addEventListener('click', () => {
  const part = createPart(doc, type); execute({ type: 'addPart', part }, part.id);
});
$('#delete').addEventListener('click', () => execute({ type: 'removePart', partId: selectedId }, null));
$('#undo').addEventListener('click', () => { doc = history.undo(doc); refresh(); status('元に戻しました。'); });
$('#redo').addEventListener('click', () => { doc = history.redo(doc); refresh(); status('やり直しました。'); });
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
for (const color of ['#e0a070', '#e8ce9e', '#c96c64', '#689caa', '#646f8c', '#849b69', '#b692bb', '#ece5d8']) {
  const button = document.createElement('button'); button.type = 'button'; button.style.backgroundColor = color; button.setAttribute('aria-label', `色を${color}に変更`);
  button.addEventListener('click', () => execute({ type: 'setColor', partId: selectedId, color })); $('#palette').append(button);
}
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
    doc = loaded; history.reset(); selectedId = doc.parts[0]?.id ?? null; refresh(); status(`${file.name}を読み込みました。`);
  } catch (error) { status(`読込できませんでした：${error.message}`, true); }
  finally { event.target.value = ''; }
});
try {
  viewport = createViewport($('#viewport'), $('#canvas-host'), select, commitTransform, previewTransform);
  setTransformMode(transformMode); refresh();
}
catch (error) { refresh(); status(`3D表示を開始できませんでした：${error.message}`, true); }
