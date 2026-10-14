// はたけノート向けお手本サンプル「トマトの株」を生成する。
// 1単位＝1cm（doc.unitCm = 1）、全高約1.2m。支柱つきで、葉・実・花はすべて単色（ベタ塗り）パーツ。
// 使い方: node tools/make-tomato-sample.mjs   （node_modules に three が必要：npm install）
// 出力: samples/tomato-plant.json（ModelDoc）と samples/tomato-plant.glb（メートル単位のglTF）
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyCommand } from '../src/commands.js';
import { createNewDoc, serializeDoc, modelExtent } from '../src/model.js';
import { buildGlb } from '../src/gltf-export.js';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'samples');
const COLOR = {
  stake: '#c9a45c', tie: '#e8e2d0', soil: '#6b4a2f', stem: '#5c8f3d',
  leafA: '#3f7d34', leafB: '#4f9440', red: '#d63a2f', green: '#8fb84a', calyx: '#2f6b2a', flower: '#f2d03b',
};
let doc = createNewDoc();
doc = applyCommand(doc, { type: 'removePart', partId: doc.parts[0].id });
doc = { ...doc, name: 'トマトの株', unitCm: 1, texelsPerUnit: 1, palette: Object.values(COLOR).slice(0, 8) };
// 色は単色モード（ベタ塗り）。パレット外の任意の色でもよい。
const add = (name, type, props) => {
  doc = applyCommand(doc, { type: 'addPart', part: { name, type, colorMode: 'solid', ...props } });
};
const r = Math.round;
const deg = value => ((Math.round(value) % 360) + 360) % 360;

// 土の盛り（直径約24cm）と支柱（高さ124cm）
add('土', 'cylinder', { radius: 12, radiusTop: 8, radiusBottom: 12, height: 4, segments: 12, position: [0, 2, 0], color: COLOR.soil });
add('支柱', 'cylinder', { radius: 1, radiusTop: 1, radiusBottom: 1, height: 124, segments: 6, position: [-7, 62, 0], color: COLOR.stake });
// 茎（太さ約3〜4cm、高さ110cm）
add('茎', 'cylinder', { radius: 2, radiusTop: 1, radiusBottom: 2, height: 110, segments: 8, position: [0, 55, 0], color: COLOR.stem });
// 誘引のひも（茎と支柱の間）
[28, 60, 92].forEach((y, i) => add(`ひも${i + 1}`, 'box', { size: [8, 1, 3], position: [-3, y, 0], color: COLOR.tie }));

// 複葉：葉柄＋先端の小葉＋左右の小葉。各高さで反対向きの2枚を出し、高さごとに x軸／z軸の向きを交互に回す。
const leafHeights = [20, 32, 44, 56, 68, 80, 92, 102];
leafHeights.forEach((height, level) => {
  const axis = level % 2 === 0 ? 0 : 2;
  for (const sign of [1, -1]) {
    const dirName = axis === 0 ? (sign > 0 ? '右' : '左') : (sign > 0 ? '手前' : '奥');
    const long = axis === 0 ? 'x' : 'z';
    const tilt = 12 * (long === 'x' ? sign : -sign); // 外端が持ち上がる向き
    const rotation = long === 'x' ? [0, 0, deg(tilt)] : [deg(tilt), 0, 0];
    const place = (distance, side) => {
      const rise = Math.sin((12 * Math.PI) / 180) * distance;
      const p = [0, height + rise, 0];
      p[axis] = sign * distance;
      p[axis === 0 ? 2 : 0] = side;
      return p.map(r);
    };
    const scale = 1 - level * 0.05; // 上の葉ほど小さい
    const L = n => Math.max(2, r(n * scale));
    const stalk = L(16);
    const sizeOf = (along, thick, across) => long === 'x' ? [along, thick, across] : [across, thick, along];
    const leafColor = (level + (sign > 0 ? 0 : 1)) % 2 ? COLOR.leafA : COLOR.leafB;
    const label = `葉${level + 1}(${dirName})`;
    add(`${label}_葉柄`, 'box', { size: sizeOf(stalk, 1, 1), position: place(stalk / 2, 0), rotation, color: COLOR.stem });
    add(`${label}_先端の小葉`, 'box', { size: sizeOf(L(14), 1, L(10)), position: place(stalk + L(14) / 2 - 1, 0), rotation, color: leafColor });
    for (const side of [-1, 1]) {
      add(`${label}_側小葉${side < 0 ? 1 : 2}`, 'box', { size: sizeOf(L(9), 1, L(6)), position: place(stalk * 0.6, side * L(7)), rotation, color: leafColor });
    }
  }
});

// 実：赤（熟した）と緑（未熟）。茎から x/z 軸方向へ果柄（細い箱）を伸ばして吊るし、上にヘタ（小さな円柱）を載せる。
const fruits = [
  { axis: 0, sign: 1, dist: 8, y: 33, radius: 4, ripe: true }, { axis: 2, sign: -1, dist: 8, y: 27, radius: 4, ripe: true },
  { axis: 0, sign: -1, dist: 7, y: 36, radius: 3, ripe: true }, { axis: 2, sign: 1, dist: 8, y: 62, radius: 3, ripe: true },
  { axis: 0, sign: 1, dist: 7, y: 58, radius: 3, ripe: false }, { axis: 2, sign: -1, dist: 7, y: 66, radius: 3, ripe: false },
  { axis: 0, sign: -1, dist: 6, y: 86, radius: 2, ripe: false }, { axis: 2, sign: 1, dist: 6, y: 90, radius: 2, ripe: false },
];
fruits.forEach(({ axis, sign, dist, y, radius, ripe }, i) => {
  const at = [0, y, 0]; at[axis] = sign * dist;
  const pedicel = [0, y + radius, 0]; pedicel[axis] = (sign * dist) / 2;
  add(`実${i + 1}`, 'sphere', { radius, segments: 10, position: at, color: ripe ? COLOR.red : COLOR.green });
  add(`ヘタ${i + 1}`, 'cylinder', { radius: 2, radiusTop: 1, radiusBottom: 2, height: 1, segments: 6, position: [at[0], y + radius, at[2]], color: COLOR.calyx });
  add(`果柄${i + 1}`, 'box', { size: axis === 0 ? [dist, 1, 1] : [1, 1, dist], position: pedicel.map(r), color: COLOR.stem });
});
// 花（先端付近）
[[3, 110, 2], [-3, 104, -3], [2, 98, -4]].forEach(([x, y, z], i) => add(`花${i + 1}`, 'sphere', { radius: 1, segments: 6, position: [x, y, z], color: COLOR.flower }));
// 頂芽
add('頂芽', 'sphere', { radius: 2, segments: 8, position: [0, 112, 0], color: COLOR.leafB });

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'tomato-plant.json'), serializeDoc(doc) + '\n');
const { glb, stats } = buildGlb(doc); // doc.unitCm=1 なので 1単位=0.01m で出る
writeFileSync(join(outDir, 'tomato-plant.glb'), glb);
const extent = modelExtent(doc);
console.log(`パーツ ${doc.parts.length} 個 / 頂点 ${stats.vertices} / 三角形 ${stats.triangles} / ${stats.byteLength} bytes`);
console.log(`単位サイズ(cm): ${extent.size.map(v => v.toFixed(0)).join(' x ')} / glb高さ(m): ${stats.boundsMeters.size[1].toFixed(2)}`);
