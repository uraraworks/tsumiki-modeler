// MCPサーバーからの要求を、ページ内の既存モデル操作へ中継する最小ブリッジ。
const RECONNECT_DELAY_MS = 3000;

export function connectMcpBridge(handlers, indicator) {
  const params = new URLSearchParams(location.search);
  if (params.get('bridge') !== '1') return null;

  const port = params.get('bridgePort') || '3099';
  const url = `ws://127.0.0.1:${port}`;
  let socket = null, reconnectTimer = null;

  const show = (text, connected = false) => {
    indicator.hidden = false;
    indicator.textContent = text;
    indicator.classList.toggle('connected', connected);
  };
  const scheduleReconnect = () => {
    if (reconnectTimer !== null) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; open(); }, RECONNECT_DELAY_MS);
  };
  const open = () => {
    show('MCP接続待ち');
    const ws = new WebSocket(url);
    socket = ws;
    ws.addEventListener('open', () => {
      if (socket !== ws) return;
      ws.send(JSON.stringify({ type: 'hello', role: 'tsumiki-modeler' }));
      show('MCP接続中', true);
    });
    ws.addEventListener('close', () => {
      if (socket === ws) socket = null;
      show('MCP再接続待ち');
      scheduleReconnect();
    });
    ws.addEventListener('error', scheduleReconnect);
    ws.addEventListener('message', event => { void handleMessage(ws, event); });
  };
  const handleMessage = async (ws, event) => {
    let message;
    try { message = JSON.parse(String(event.data)); }
    catch (error) { console.error('[Tsumiki MCP bridge] invalid message', error); return; }
    const { id, cmd, args = {} } = message;
    try {
      const handler = handlers[cmd];
      if (!handler) throw new Error(`未対応のブリッジコマンドです: ${String(cmd)}`);
      const result = await handler(args);
      ws.send(JSON.stringify({ id, ok: true, result }));
    } catch (error) {
      ws.send(JSON.stringify({ id, ok: false, error: error instanceof Error ? error.message : String(error) }));
    }
  };

  open();
  return { close() { if (reconnectTimer !== null) clearTimeout(reconnectTimer); socket?.close(); } };
}
