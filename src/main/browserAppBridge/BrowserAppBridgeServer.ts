import { createReadStream, existsSync, statSync } from 'fs';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { request as httpsRequest } from 'https';
import { extname, join, normalize, resolve } from 'path';
import { URL } from 'url';
import { invokeRegisteredIpcChannel } from '../ipc/invokeRegistry';
import { rendererEventHub } from './rendererEventHub';

type BridgeOptions = {
  devRendererUrl: string | null;
  rendererRoot: string;
  preferredPort?: number;
};

let server: Server | null = null;
let bridgeUrl: string | null = null;

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function setCors(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'content-type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Private-Network', 'true');
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  setCors(response);
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function checkDevRenderer(url: string): Promise<{ ok: boolean; url: string; error?: string }> {
  return new Promise((resolveCheck) => {
    const target = new URL(url);
    const requestImpl = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = requestImpl(
      {
        method: 'GET',
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        timeout: 1500,
      },
      (response) => {
        response.resume();
        const ok = Boolean(response.statusCode && response.statusCode >= 200 && response.statusCode < 400);
        resolveCheck({
          ok,
          url,
          ...(ok ? {} : { error: response.statusCode ? `HTTP ${response.statusCode}` : 'Missing status code' }),
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error('Timed out while connecting to the dev renderer'));
    });
    request.on('error', (error) => {
      resolveCheck({ ok: false, url, error: error.message });
    });
    request.end();
  });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf-8').trim();
  return text ? JSON.parse(text) : {};
}

function redirectToDevRenderer(response: ServerResponse, rendererUrl: string, bridgeOrigin: string): void {
  const target = new URL(rendererUrl);
  target.searchParams.set('rdcBridgeOrigin', bridgeOrigin);
  response.writeHead(302, {
    Location: target.toString(),
    'Cache-Control': 'no-store',
  });
  response.end();
}

function serveStatic(response: ServerResponse, rendererRoot: string, requestPath: string): void {
  const relativePath = requestPath === '/app' || requestPath === '/app/'
    ? 'index.html'
    : requestPath.replace(/^\/app\/?/, '').replace(/^\//, '');
  const requestedPath = normalize(join(rendererRoot, relativePath || 'index.html'));
  const root = resolve(rendererRoot);
  const fallbackIndex = join(root, 'index.html');
  const filePath = requestedPath.startsWith(root) && existsSync(requestedPath) && statSync(requestedPath).isFile()
    ? requestedPath
    : fallbackIndex;

  if (!existsSync(filePath)) {
    sendJson(response, 404, { success: false, error: 'Renderer build output not found' });
    return;
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
  });
  createReadStream(filePath).pipe(response);
}

async function handleRequest(options: BridgeOptions, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!request.url) {
    sendJson(response, 400, { success: false, error: 'Missing URL' });
    return;
  }

  if (request.method === 'OPTIONS') {
    setCors(response);
    response.writeHead(204);
    response.end();
    return;
  }

  const bridgeOrigin = bridgeUrl ?? 'http://127.0.0.1';
  const url = new URL(request.url, bridgeOrigin);

  if (url.pathname === '/api/settings/providers/catalog' && request.method === 'GET') {
    const catalog = await invokeRegisteredIpcChannel('settings:getProviderCatalog');
    sendJson(response, 200, catalog);
    return;
  }

  if (url.pathname === '/health' && request.method === 'GET') {
    const renderer = options.devRendererUrl
      ? await checkDevRenderer(options.devRendererUrl)
      : { ok: existsSync(join(options.rendererRoot, 'index.html')), url: null };
    sendJson(response, 200, {
      ok: renderer.ok,
      productName: 'RDC-Agent',
      mode: 'browser-app-session',
      bridgeUrl,
      renderer,
    });
    return;
  }

  if (url.pathname === '/invoke' && request.method === 'POST') {
    void readJsonBody(request)
      .then(async (body) => {
        const payload = body as { channel?: unknown; args?: unknown };
        if (typeof payload.channel !== 'string') {
          sendJson(response, 400, { success: false, error: 'channel must be a string' });
          return;
        }
        const args = Array.isArray(payload.args) ? payload.args : [];
        const result = await invokeRegisteredIpcChannel(payload.channel, args);
        sendJson(response, 200, { success: true, result });
      })
      .catch((error) => {
        sendJson(response, 500, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return;
  }

  if (url.pathname === '/events' && request.method === 'GET') {
    rendererEventHub.connect(response);
    return;
  }

  if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
    if (options.devRendererUrl) {
      const renderer = await checkDevRenderer(options.devRendererUrl);
      if (!renderer.ok) {
        sendJson(response, 503, {
          success: false,
          error: 'Dev renderer is not reachable',
          renderer,
        });
        return;
      }
      redirectToDevRenderer(response, options.devRendererUrl, bridgeOrigin);
      return;
    }
    serveStatic(response, options.rendererRoot, url.pathname);
    return;
  }

  if (!options.devRendererUrl && (url.pathname.startsWith('/assets/') || url.pathname === '/favicon.ico')) {
    serveStatic(response, options.rendererRoot, url.pathname);
    return;
  }

  sendJson(response, 404, { success: false, error: 'Not found' });
}

export async function startBrowserAppBridge(options: BridgeOptions): Promise<string> {
  if (server && bridgeUrl) {
    return bridgeUrl;
  }

  const preferredPort = options.preferredPort ?? Number(process.env.RDC_AGENT_BROWSER_BRIDGE_PORT || 5127);

  server = createServer((request, response) => {
    void handleRequest(options, request, response).catch((error) => {
      sendJson(response, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    const activeServer = server;
    if (!activeServer) {
      rejectListen(new Error('Browser app bridge server was not created'));
      return;
    }

    const listen = (port: number): void => {
      activeServer.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE' && port !== 0) {
          listen(0);
          return;
        }
        rejectListen(error);
      });
      activeServer.listen(port, '127.0.0.1', () => resolveListen());
    };

    listen(preferredPort);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : preferredPort;
  bridgeUrl = `http://127.0.0.1:${port}`;
  (globalThis as typeof globalThis & { __RDC_AGENT_BROWSER_BRIDGE_URL__?: string }).__RDC_AGENT_BROWSER_BRIDGE_URL__ = bridgeUrl;
  console.log(`[BrowserAppBridge] Browser app session: ${bridgeUrl}/app`);
  return bridgeUrl;
}

export async function stopBrowserAppBridge(): Promise<void> {
  const activeServer = server;
  server = null;
  bridgeUrl = null;
  delete (globalThis as typeof globalThis & { __RDC_AGENT_BROWSER_BRIDGE_URL__?: string }).__RDC_AGENT_BROWSER_BRIDGE_URL__;
  if (!activeServer) {
    return;
  }
  await new Promise<void>((resolveClose) => activeServer.close(() => resolveClose()));
}
