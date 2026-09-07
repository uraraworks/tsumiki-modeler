#!/usr/bin/env node
// stdoutはMCP stdio transport専用。診断ログは必ずstderrへ出す。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer } from 'ws';
import { z } from 'zod';

const BRIDGE_PORT = Number(process.env.TSUMIKI_BRIDGE_PORT) || 3099;
const REQUEST_TIMEOUT_MS = 15000;
let activeClient = null, nextRequestId = 1;
const pending = new Map();

const wss = new WebSocketServer({ host: '127.0.0.1', port: BRIDGE_PORT });
wss.on('listening', () => console.error(`Tsumiki WebSocket bridge listening on 127.0.0.1:${BRIDGE_PORT}`));
wss.on('error', error => console.error('WebSocket server error:', error?.stack ?? error));
wss.on('connection', ws => {
  console.error('Tsumiki browser client connected');
  ws.on('message', data => {
    let message;
    try { message = JSON.parse(data.toString()); }
    catch (error) { console.error('Received non-JSON message:', error.message); return; }
    if (message?.type === 'hello' && message.role === 'tsumiki-modeler') {
      if (activeClient && activeClient !== ws && activeClient.readyState === activeClient.OPEN) activeClient.close();
      activeClient = ws;
      console.error('Active Tsumiki client registered');
      return;
    }
    if (typeof message?.id !== 'number') return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(new Error(message.error || 'ブラウザから不明なエラーが返されました。'));
  });
  ws.on('close', () => {
    if (activeClient !== ws) return;
    activeClient = null;
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer); entry.reject(new Error('BRIDGE_DISCONNECTED')); pending.delete(id);
    }
    console.error('Active Tsumiki client disconnected');
  });
  ws.on('error', error => console.error('Browser socket error:', error?.stack ?? error));
});

function sendCommand(cmd, args = {}) {
  if (!activeClient || activeClient.readyState !== activeClient.OPEN) return Promise.reject(new Error('BRIDGE_DISCONNECTED'));
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`ブラウザの '${cmd}' 応答がタイムアウトしました。`)); }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    try { activeClient.send(JSON.stringify({ id, cmd, args })); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}

const NOT_CONNECTED_MESSAGE =
  `ブラウザが未接続です。つみきモデラーを ?bridge=1 付きで開いてください（既定: http://localhost:8000/?bridge=1、WebSocket: 127.0.0.1:${BRIDGE_PORT}）。`;
async function withBridge(handler) {
  try { return await handler(); }
  catch (error) {
    return { isError: true, content: [{ type: 'text', text: error?.message === 'BRIDGE_DISCONNECTED' ? NOT_CONNECTED_MESSAGE : `Error: ${error?.message ?? String(error)}` }] };
  }
}
const jsonText = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

const server = new McpServer({ name: 'tsumiki-modeler-mcp', version: '0.1.0' });

server.tool('get_model', '現在のつみきモデラーのModelDocをJSONで取得します。ModelDocが編集状態の唯一の真実です。', {}, async () =>
  withBridge(async () => jsonText(await sendCommand('get_model'))));

const COMMAND_DESCRIPTION = `コマンド配列を順番に既存applyCommandへ渡し、バッチ全体をUndo履歴1件として適用します。途中で失敗した場合は全体を適用しません。使用可能な形:
- {type:"addPart", part:{name,type,position,size?,radius?,radiusTop?,radiusBottom?,height?,segments?,rotation?,color?,bone?,texture?,id?}}
  typeは"box"、"cylinder"、"sphere"、"capsule"。idは未指定時にp1,p2,...から空き番号を採番。size=[2,4,2], radius=2, height=4, segments=8（sphereのみ新規作成時10）, rotation=[0,0,0], bone=null。colorはパレット先頭色。textureは最終形状に合う空テクスチャ。boxはsize、sphereはradius/segments、capsuleはradius/height/segmentsを使う。cylinderはradiusTop/radiusBottom未指定時にradiusを両方へ使い、個別指定で円錐台、radiusTop=0で円錐になる。
- {type:"removePart", partId:string}
- {type:"setTransform", partId:string, transform:{position?:[x,y,z],size?:[x,y,z],rotation?:[x,y,z],radius?:number,radiusTop?:number,radiusBottom?:number,height?:number,segments?:number}}
- {type:"setColor", partId:string, color:"#rrggbb"}
- {type:"rename", partId:string, name:string}
- {type:"assignPartBone", partId:string, boneId:string|null}
- {type:"paintPixels", partId:string, pixels:[[x,y,"."またはパレット文字],...]}
- {type:"convertToMesh", partId:string}
  箱(box)パーツを頂点・面を直接持つmesh型へ変換します。現在は箱からの変換のみ対応（他の形状を指定するとエラー）。変換後のパーツはsizeを持たず、vertices:[[x,y,z],...]（整数座標、外から見て反時計回りの面）とfaces:[[i,j,k,l]または[i,j,k],...]（vertices内インデックス）を持ちます。UVは面ごとに平面展開するため、変換直後（全面が軸に平行な矩形）は元の箱の6面展開と同じ見た目になります。mesh型はaddPartでは作成できず、このコマンドでのみ生成されます。
- {type:"extrudeFace", partId:string, faces:number[], distance:number}
  meshパーツの指定した面（faces:part.faces内のインデックス配列、複数指定可、各面を個別にその法線方向へ押し出す）を、1グリッド単位でdistanceだけ法線方向へ押し出します。負のdistanceで内側へ凹ませられます。distance=0は何もしません（コマンドとして発行しても履歴に積まれません）。元の面は新しい位置の面に置き換わり、辺ごとに側面の四角形が追加されます（四角形1面につき頂点+4・面+4）。頂点は複製され、常に整数座標を保ちます。テクスチャは面の対応関係から可能な限り引き継ぎ、新しくできた側面・移動後の面のうち対応の無い部分は未指定（.）で埋まります。
- {type:"addBone", bone:{id?,name?,parent?,position?,rotation?}}
  idは未指定時にb1,b2,...から空き番号を採番。name="ボーン N", parent=null, position=[0,0,0]（parent指定時は[0,2,0]）, rotation=[0,0,0]。
- {type:"removeBone", boneId:string}
- {type:"setBoneTransform", boneId:string, transform:{position?:[x,y,z],rotation?:[x,y,z]}}
- {type:"setBoneParent", boneId:string, parent:string|null}
- {type:"renameBone", boneId:string, name:string}
- {type:"addAnimation", animation:{id,name,fps,length,tracks}}
- {type:"setKeyframe", animationId:string, boneId:string, frame:number, rotation:[x,y,z]}
- {type:"removeKeyframe", animationId:string, boneId:string, frame:number}
- {type:"setClipSettings", animationId:string, fps?:number, length?:number}`;
server.tool('apply_commands', COMMAND_DESCRIPTION, {
  commands: z.array(z.record(z.unknown())).min(1).describe('順番に適用するコマンド（1件以上）。'),
}, async ({ commands }) => withBridge(async () => jsonText(await sendCommand('apply_commands', { commands }))));

server.tool('create_from_spec', '完全なModelDocで現在モデルを丸ごと差し替えます。ブラウザ本体のvalidateDocに合格した場合だけ適用し、Undo履歴1件にします。不正時は修正に使える検証理由を返します。', {
  model: z.record(z.unknown()).describe('version, name, grid, texelsPerUnit, palette, parts, bones, animationsを持つ完全なModelDoc。'),
}, async ({ model }) => withBridge(async () => jsonText(await sendCommand('create_from_spec', { model }))));

server.tool('validate_model', '現在のModelDocをvalidateDocで検査します。エラーとは別に、未割当パーツ、未使用パレット色、名前重複、左右名（左/右・_l/_r）の不揃いを警告として返します。', {}, async () =>
  withBridge(async () => jsonText(await sendCommand('validate_model'))));

server.tool('render_preview', '現在モデルだけを384x216 PNGで描画します。cameraでfront（+Z）/side（+X）/back（-Z）/top（+Y）/isoを指定でき、省略時はisoで全パーツが約10%の余白付きで収まる距離へ自動調整します。方位角・仰角（度）・距離も指定でき、frame指定時はアニメーション姿勢を描画します。ボーン、ギズモ、グリッドは描画せず、編集中のカメラも変更しません。', {
  camera: z.enum(['front', 'side', 'back', 'top', 'iso']).optional().describe('カメラプリセット。既定はiso。数値指定は同じ軸だけ上書きします。'),
  preset: z.enum(['front', 'side', 'back', 'top', 'iso']).optional().describe('後方互換用のcamera別名。cameraが優先されます。'),
  azimuth: z.number().optional().describe('モデル中心から見た方位角（度）。0は正面（+Z）、90は側面（+X）。'),
  elevation: z.number().min(-90).max(90).optional().describe('モデル中心から見た仰角（度）。'),
  distance: z.number().positive().optional().describe('モデル中心からカメラまでの距離。省略時はモデル全体が収まるよう自動調整。'),
  fit: z.boolean().optional().describe('省略した距離の自動調整。既定はtrue。false時の既定距離は30。'),
  animation_id: z.string().optional().describe('frameを描画するアニメーションID。省略時は先頭のアニメーション。'),
  frame: z.number().int().optional().describe('描画するアニメーションのフレーム番号。'),
}, async ({ camera, preset, azimuth, elevation, distance, fit, animation_id, frame }) => withBridge(async () => {
  const result = await sendCommand('render_preview', { camera, preset, azimuth, elevation, distance, fit, animationId: animation_id, frame });
  if (typeof result?.base64 !== 'string') throw new Error('ブラウザからPNGデータが返されませんでした。');
  return { content: [
    { type: 'text', text: '384x216 PNG preview' },
    { type: 'image', data: result.base64, mimeType: 'image/png' },
  ] };
}));

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Tsumiki MCP server connected via stdio');
