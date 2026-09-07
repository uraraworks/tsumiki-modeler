import assert from 'node:assert/strict';
import { formatVersionFooter, UNKNOWN_VERSION_FOOTER } from '../tools/version.mjs';

// --- JST変換：unix秒からJST(UTC+9固定オフセット)の年月日時分が正しく求まること ---
// 2026-09-07T18:46:00+09:00 は UTC 2026-09-07T09:46:00Z
const ts = Date.UTC(2026, 8, 7, 9, 46, 0) / 1000;
assert.equal(
  formatVersionFooter(ts, '4fa9a31', false),
  'つみき 2026-09-07 18:46 JST (4fa9a31)',
  'クリーンな作業ツリーでは末尾に+が付かない',
);

// --- dirtyな作業ツリーでは末尾に "+" が付くこと ---
assert.equal(
  formatVersionFooter(ts, '4fa9a31', true),
  'つみき 2026-09-07 18:46 JST (4fa9a31+)',
  '作業ツリーが汚れている場合は末尾に+が付く',
);

// --- 日付境界：UTC日付とJST日付がずれるケース(UTC 15:00→JST翌日0:00)でも正しく繰り上がること ---
const boundaryTs = Date.UTC(2026, 0, 1, 15, 0, 0) / 1000; // UTC 2026-01-01 15:00 -> JST 2026-01-02 00:00
assert.equal(
  formatVersionFooter(boundaryTs, '0000000', false),
  'つみき 2026-01-02 00:00 JST (0000000)',
  '日付境界をまたぐ場合もJSTの日付に正しく繰り上がる',
);

// --- ホストのタイムゾーン設定に依存しないこと(TZ環境変数を変えても結果が変わらない) ---
const before = process.env.TZ;
process.env.TZ = 'America/Los_Angeles';
assert.equal(
  formatVersionFooter(ts, '4fa9a31', false),
  'つみき 2026-09-07 18:46 JST (4fa9a31)',
  'TZ環境変数を変えてもJST固定オフセットの結果は変わらない',
);
process.env.TZ = before;

// --- git情報が取れない場合のフォールバック値 ---
assert.equal(UNKNOWN_VERSION_FOOTER, 'つみき (version unknown)');

console.log('version tests: OK');
