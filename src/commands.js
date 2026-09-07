import { PALETTE_CHARS, cloneDoc, createBlankTexture, resizePartTexture, validateDoc } from './model.js';
// 入力を変更せず、新しい検証済みドキュメントを返す。
export function applyCommand(doc, cmd) {
  const next = cloneDoc(doc);
  if (cmd.type === 'addPart') next.parts.push(cloneDoc(cmd.part));
  else if (cmd.type === 'addBone') next.bones.push(cloneDoc(cmd.bone));
  else if (cmd.type === 'addAnimation') {
    if (!Array.isArray(next.animations)) next.animations = [];
    next.animations.push(cloneDoc(cmd.animation));
  }
  else if (['setKeyframe', 'removeKeyframe', 'setClipSettings'].includes(cmd.type)) {
    const animation = next.animations?.find(candidate => candidate.id === cmd.animationId);
    if (!animation) throw new Error('対象のアニメーションが見つかりません。');
    if (cmd.type === 'setClipSettings') {
      if (cmd.fps !== undefined) animation.fps = cmd.fps;
      if (cmd.length !== undefined) {
        animation.length = cmd.length;
        if (Number.isSafeInteger(cmd.length) && cmd.length > 0) {
          for (const track of animation.tracks) track.keys = track.keys.filter(key => key.frame < cmd.length);
        }
      }
    } else {
      if (!next.bones.some(bone => bone.id === cmd.boneId)) throw new Error('対象のボーンが見つかりません。');
      let track = animation.tracks.find(candidate => candidate.boneId === cmd.boneId);
      if (cmd.type === 'setKeyframe') {
        if (!track) { track = { boneId: cmd.boneId, keys: [] }; animation.tracks.push(track); }
        const key = track.keys.find(candidate => candidate.frame === cmd.frame);
        if (key) key.rotation = cloneDoc(cmd.rotation);
        else track.keys.push({ frame: cmd.frame, rotation: cloneDoc(cmd.rotation) });
        track.keys.sort((left, right) => left.frame - right.frame);
      } else if (track) {
        track.keys = track.keys.filter(key => key.frame !== cmd.frame);
        if (!track.keys.length) animation.tracks = animation.tracks.filter(candidate => candidate !== track);
      }
    }
  }
  else if (['removeBone', 'setBoneTransform', 'setBoneParent', 'renameBone'].includes(cmd.type)) {
    const index = next.bones.findIndex(bone => bone.id === cmd.boneId);
    if (index < 0) throw new Error('対象のボーンが見つかりません。');
    const bone = next.bones[index];
    if (cmd.type === 'removeBone') {
      const removed = new Set([bone.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of next.bones) if (removed.has(candidate.parent) && !removed.has(candidate.id)) { removed.add(candidate.id); changed = true; }
      }
      next.bones = next.bones.filter(candidate => !removed.has(candidate.id));
      for (const part of next.parts) if (removed.has(part.bone)) part.bone = null;
      for (const animation of next.animations ?? []) animation.tracks = animation.tracks.filter(track => !removed.has(track.boneId));
    } else if (cmd.type === 'setBoneTransform') {
      for (const [key, value] of Object.entries(cmd.transform)) {
        if (!['position', 'rotation'].includes(key)) throw new Error('未対応のボーン変形プロパティです。');
        bone[key] = structuredClone(value);
      }
    } else if (cmd.type === 'setBoneParent') bone.parent = cmd.parent;
    else bone.name = cmd.name;
  }
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
      case 'assignPartBone': part.bone = cmd.boneId; break;
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
