#!/usr/bin/env node
// git情報から src/version.js を生成するスクリプト（副作用あり: gitコマンドを実行し、
// src/version.js に書き込む）。つみきモデラーはビルドツールを持たない素の ES Modules
// 構成のため、姉妹プロジェクト WebNP2 のように Vite の define でビルド時に版文字列を
// 埋め込むことができない。代わりに、このスクリプトを手動実行して静的な src/version.js を
// 生成し、それを src/main.js が import する方式にしている。
//
// 【重要な制約】埋め込まれるハッシュは実行時点の HEAD のものであり、原理的に
// 「生成された src/version.js を含むコミット自身のハッシュ」にはなり得ない（自己参照）。
// --amend で含め直しても、コミット内容が変わることでハッシュも変わるため解決しない。
// 表示されるのは「直前のコミットを指す版」と理解すること。
// どのビルドを見ているかの識別という目的には、これで十分に機能する。
//
// 実行方法: node tools/update-version.mjs
//
// 整形ロジックは純関数として tools/version.mjs に分離してあり、そちらは
// tests/version.mjs から単体テストできる。

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { formatVersionFooter, UNKNOWN_VERSION_FOOTER } from './version.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const OUTPUT_PATH = path.join(REPO_ROOT, 'src', 'version.js');

function runGit(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

function computeFooter() {
  try {
    // --date=format はgitのバージョン/ロケールに挙動差があるため使わない。
    // unix秒(%ct、コミッターdate)を取り、JS側でJST固定オフセット変換する
    // (tools/version.mjs の formatVersionFooter 参照)方が環境非依存で確実。
    const commitTsStr = runGit(['log', '-1', '--format=%ct']).trim();
    const hash = runGit(['rev-parse', '--short=7', 'HEAD']).trim();
    const status = runGit(['status', '--porcelain']);
    if (!commitTsStr || !hash) {
      throw new Error('git出力が空でした');
    }
    const commitTs = Number(commitTsStr);
    if (!Number.isFinite(commitTs)) {
      throw new Error(`commit時刻の解析に失敗しました: ${commitTsStr}`);
    }
    return formatVersionFooter(commitTs, hash, status.trim().length > 0);
  } catch (err) {
    // gitが無い/リポジトリでない等。もっともらしい値で埋めず'unknown'で明示し、
    // このスクリプト自体は失敗させない。
    console.warn(
      '[update-version] git情報の取得に失敗したため版文字列を unknown にします:',
      err instanceof Error ? err.message : err,
    );
    return UNKNOWN_VERSION_FOOTER;
  }
}

const footer = computeFooter();
const source = `// src/version.js（自動生成。手で編集しないこと）
// 生成: node tools/update-version.mjs
//
// 【制約】埋め込まれているのは生成を実行した時点のHEADのハッシュであり、この
// ファイルを含むコミット自身のハッシュではない（自己参照は原理的に不可能）。
// 表示されるのは直前のコミットを指す版。
export const VERSION_FOOTER = ${JSON.stringify(footer)};
`;

writeFileSync(OUTPUT_PATH, source);
console.log(`[update-version] ${OUTPUT_PATH} を生成しました: ${footer}`);
