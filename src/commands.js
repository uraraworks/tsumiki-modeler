import { cloneDoc, createBlankTexture, resizePartTexture, validateDoc } from './model.js';
const PALETTE_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';
// 入力を変更せず、新しい検証済みドキュメントを返す。
export function applyCommand(doc, cmd) {
  const next = cloneDoc(doc);
  if (cmd.type === 'addPart') next.parts.push(cloneDoc(cmd.part));
  else {
    const index = next.parts.findIndex(p => p.id === cmd.partId);
    if (index < 0) throw new Error('対象のパーツが見つかりません。');
    const part = next.parts[index];
    switch (cmd.type) {
      case 'removePart': next.parts.splice(index, 1); break;
      case 'setTransform':
        for (const [key, value] of Object.entries(cmd.transform)) {
          if (!['position', 'size', 'rotation', 'radius', 'height', 'segments'].includes(key)) throw new Error('未対応の変形プロパティです。');
          part[key] = structuredClone(value);
        }
        // 不正な巨大値で行列を確保する前に、従来の上限検証へ回す。
        if ((part.type === 'box' ? part.size : [part.radius, part.height]).every(value => Number.isSafeInteger(value) && value >= 1 && value <= 10000)) resizePartTexture(part, next.texelsPerUnit);
        break;
      case 'setColor': part.color = cmd.color; break;
      case 'rename': part.name = cmd.name; break;
      case 'paintPixels': {
        if (!Array.isArray(cmd.pixels)) throw new Error('ペイント内容が不正です。');
        const pixels = new Map();
        for (const pixel of cmd.pixels) {
          if (!Array.isArray(pixel) || pixel.length !== 3) throw new Error('ペイント内容が不正です。');
          const [x, y, character] = pixel;
          if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || typeof character !== 'string' || character.length !== 1 || !`.${PALETTE_CHARS.slice(0, next.palette.length)}`.includes(character)) throw new Error('ペイント内容が不正です。');
          pixels.set(`${x},${y}`, [x, y, character]);
        }
        const texture = part.texture ?? createBlankTexture(part, next.texelsPerUnit);
        const [width, height] = texture.size;
        const changes = [];
        for (const [x, y, character] of pixels.values()) {
          if (x < 0 || x >= width || y < 0 || y >= height) throw new Error('ペイント座標がテクスチャ範囲外です。');
          if (texture.rows[y][x] !== character) changes.push([x, y, character]);
        }
        if (!changes.length) break;
        if (!part.texture) part.texture = texture;
        for (const [x, y, character] of changes) {
          part.texture.rows[y] = `${part.texture.rows[y].slice(0, x)}${character}${part.texture.rows[y].slice(x + 1)}`;
        }
        break;
      }
      default: throw new Error('未対応のコマンドです。');
    }
  }
  return validateDoc(next);
}
export class CommandHistory {
  constructor() { this.past = []; this.future = []; }
  execute(doc, cmd) {
    const next = applyCommand(doc, cmd);
    if (JSON.stringify(next) === JSON.stringify(doc)) return doc;
    this.past.push({ command: structuredClone(cmd), before: cloneDoc(doc), after: cloneDoc(next) });
    this.future = [];
    return next;
  }
  undo(doc) {
    const entry = this.past.pop();
    if (!entry) return doc;
    this.future.push(entry);
    return cloneDoc(entry.before);
  }
  redo(doc) {
    const entry = this.future.pop();
    if (!entry) return doc;
    this.past.push(entry);
    return cloneDoc(entry.after);
  }
  reset() { this.past = []; this.future = []; }
}
