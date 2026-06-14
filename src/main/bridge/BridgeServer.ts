/**
 * BridgeServer — WebSocket 远程控制桥接。
 *
 * 允许手机/浏览器通过 WebSocket 远程控制 RDC-Agent。
 * 支持:
 *  - 权限同步（主窗口 ↔ 远程客户端）
 *  - 消息转发
 *  - 连接认证
 */
// BridgeServer — 使用 lazy require 加载 ws 模块（可选依赖）
type WsServer = { on: (e: string, cb: (...a: never[]) => void) => void; close: () => void; address: () => { port: number } | null };
type WsClient = { send: (d: string) => void; close: () => void; readyState: number; on: (e: string, cb: (...a: never[]) => void) => void };

export interface BridgeOptions { port?: number; authToken?: string; }

export class BridgeServer {
  private wss: WsServer | null = null;
  private clients = new Set<WsClient>();
  private onMessage: ((msg: string) => void) | null = null;

  constructor(private options: BridgeOptions = {}) {}

  /** 启动 WebSocket 桥接服务器。 */
  async start(): Promise<number> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let wsModule: { WebSocketServer: new (opts: { port: number }, cb?: () => void) => WsServer };
    try { wsModule = require('ws'); } catch { throw new Error('ws module not installed. Run: npm install ws'); }

    const port = this.options.port ?? 0;
    return new Promise((resolve, reject) => {
      this.wss = new wsModule.WebSocketServer({ port }, () => {
        const addr = this.wss?.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : port;
        resolve(actualPort ?? port);
      });

      this.wss.on('connection', (ws: WsClient) => {
        this.clients.add(ws);
        ws.send(JSON.stringify({ type: 'connected', message: 'Bridge established' }));
        ws.on('message', (data: Buffer) => {
          try {
            const msg = JSON.parse(data.toString());
            if (this.options.authToken && msg.token !== this.options.authToken) {
              ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
              return;
            }
            this.onMessage?.(msg.content);
          } catch { /* ignore */ }
        });
        ws.on('close', () => this.clients.delete(ws));
        ws.on('error', () => this.clients.delete(ws));
      });

      this.wss.on('error', (err: Error) => reject(err));
    });
  }

  broadcast(type: string, data: unknown): void {
    const payload = JSON.stringify({ type, data });
    for (const client of this.clients) {
      if (client.readyState === 1) client.send(payload);
    }
  }

  setOnMessage(handler: (msg: string) => void): void { this.onMessage = handler; }

  stop(): void {
    for (const client of this.clients) client.close();
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
  }

  get clientCount(): number { return this.clients.size; }
}
