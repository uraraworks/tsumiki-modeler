# つみきモデラー MCP サーバー

つみきモデラーをMCPクライアントから操作するためのstdioサーバーです。同じNode.jsプロセスが `127.0.0.1:3099` でWebSocketを待ち受け、ブラウザ内の既存コマンド・検証・描画処理へ要求を中継します。

## セットアップ

AIエージェントは次をそのまま実行できます。

```sh
cd <このリポジトリの絶対パス>/mcp
npm install
npm run bundle
```

別のターミナルでWebアプリを配信します。

```sh
cd <このリポジトリの絶対パス>
python3 -m http.server 8000
```

ブラウザで <http://localhost:8000/?bridge=1> を開き、「MCP接続中」と表示されることを確認してください。`?bridge=1` がない通常表示ではWebSocket接続を行いません。

MCPクライアントには、開発時は次のコマンドを登録します。

```json
{
  "mcpServers": {
    "tsumiki-modeler": {
      "command": "node",
      "args": ["<このリポジトリの絶対パス>/mcp/server.mjs"]
    }
  }
}
```

単一ファイル版を使う場合は `args` を `mcp/dist/tsumiki-modeler-mcp.mjs` の絶対パスへ変更してください。ポートを変える場合はMCPサーバーへ環境変数 `TSUMIKI_BRIDGE_PORT` を設定し、ページを `?bridge=1&bridgePort=変更後の番号` で開きます。

## 公開ツール

| ツール | 内容 |
|---|---|
| `get_model` | 現在のModelDocをJSONで返します。 |
| `apply_commands` | 既存コマンドを順番に適用し、バッチ全体をUndo履歴1件にします。 |
| `create_from_spec` | 検証済みModelDocで全体を差し替え、Undo履歴1件にします。 |
| `validate_model` | 構造エラーと、未割当・未使用色・命名上の警告を分けて返します。 |
| `render_preview` | `camera` (`front`/`side`/`back`/`top`/`iso`) または方位角・仰角・距離とアニメフレームを指定し、モデルだけのPNGを返します。距離省略時は全体を約10%の余白付きで自動フィットし、`fit: false` で無効化できます。選択中パーツの黄色い輪郭は写しません。 |
| `render_preview` の `resolution` / `style` | `resolution`（例 `"384x216"` 既定 / `"1024x768"`、16〜4096・合計1600万画素まで）と `style`（`"pixel"` 既定 / `"smooth"`）。`smooth` は指定解像度で2倍スーパーサンプリングのアンチエイリアス付き（トゥーンと輪郭線は維持、輪郭線の太さは解像度に応じて1〜2px相当）。`pixel` は 384x216 で描いて、`resolution` に収まる整数倍へニアレストで拡大します（既存の呼び出しは従来どおり384x216）。 |
| `export_gltf` | 現在のモデルを静的メッシュの glTF 2.0 バイナリ（.glb）で書き出します。`path` を指定するとそのパスへ保存（親ディレクトリも作成）して `savedTo` と統計を返し、省略すると `base64` を返します。`meters_per_unit`（1単位が何メートルか。省略時は `ModelDoc.unitCm/100`、未設定なら1）、`vertex_colors`（既定 true。false で `COLOR_0` を出さず `baseColorFactor` にパーツ色）。パーツ名＝ノード名、ワールド座標、単色は `COLOR_0`、ドット付きはPNGテクスチャ埋め込み。ボーン・アニメーションは対象外です。 |

### 追加コマンド（`apply_commands`）

| コマンド | 内容 |
|---|---|
| `{type:"setSolidColor", partId, color}` | 色を指定して単色（ベタ塗り）モードにする。パレット外の任意の `#rrggbb` も可 |
| `{type:"setColorMode", partId, mode:"solid"\|"texture"}` | 単色／テクスチャの切り替え（テクスチャは保持され、戻せる）。`paintPixels` で単色パーツに描くと自動でテクスチャモードになる |
| `{type:"setUnit", unitCm}` | 1単位が何cmか（`null` で換算なし）。`export_gltf` の既定スケールと画面の実寸表示に使う |
| `{type:"setGrid", grid}` | 移動・リサイズのスナップ刻み（単位数の整数） |
| `addPart` の `part.colorMode:"solid"` | テクスチャを作らず最初から単色でパーツを作る |

例：1単位＝1cmで高さ120の支柱をつくって書き出す。

```json
[{"type":"setUnit","unitCm":1},
 {"type":"addPart","part":{"name":"支柱","type":"cylinder","radius":1,"height":120,"position":[0,60,0],"colorMode":"solid","color":"#c9a45c"}}]
```

その後 `export_gltf`（`path` 指定）で `.glb` を得ます。

ブラウザが接続されていない場合、各ツールは接続方法を含むエラーを返します。WebSocketはループバックアドレスだけで待ち受けます。

## 動作確認

```sh
cd <このリポジトリの絶対パス>/mcp
node --check server.mjs
npm run bundle
node dist/tsumiki-modeler-mcp.mjs
```

起動後の診断ログはstderrへ出ます。stdoutはMCP stdio transport専用です。
