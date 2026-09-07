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
| `render_preview` | `camera` (`front`/`side`/`back`/`top`/`iso`) または方位角・仰角・距離とアニメフレームを指定し、モデルだけの384x216 PNGを返します。距離省略時は全体を約10%の余白付きで自動フィットし、`fit: false` で無効化できます。 |

ブラウザが接続されていない場合、各ツールは接続方法を含むエラーを返します。WebSocketはループバックアドレスだけで待ち受けます。

## 動作確認

```sh
cd <このリポジトリの絶対パス>/mcp
node --check server.mjs
npm run bundle
node dist/tsumiki-modeler-mcp.mjs
```

起動後の診断ログはstderrへ出ます。stdoutはMCP stdio transport専用です。
