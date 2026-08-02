import { createReadStream, existsSync, readFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { request as httpsRequest } from 'https';
import { extname, isAbsolute, join, normalize, relative, resolve } from 'path';
import { URL } from 'url';
import { invokeRegisteredIpcChannel } from '../ipc/invokeRegistry';
import { rendererEventHub } from './rendererEventHub';
import {
  buildBridgeAuthCookie,
  createBridgeBearerToken,
  resolveBridgeQueryToken,
  resolveProvidedBridgeToken,
  isBridgeChannelAllowed,
  isOriginAllowed,
  resolveBridgeAllowedOrigins,
  tokensMatch,
} from './bridgeSecurity';
import { EFFECTIVE_CATALOG_SCHEMA_VERSION } from '../settings/effectiveCatalogTypes';
import {
  MODELS_DEV_IDENTITY_COUNT,
  MODELS_DEV_SNAPSHOT_SHA256,
  PROVIDER_CATALOG_SCHEMA_VERSION,
} from '@shared/provider-catalog/compiler';
import {
  getProviderCatalogRevision,
  listProviderSummaries,
} from '../provider-catalog/ProviderCatalogRegistry';
import { SETTINGS_SCHEMA_VERSION } from '../settings/settingsDefaults';

type BridgeOptions = {
  devRendererUrl: string | null;
  rendererRoot: string;
  mainBundlePath: string;
  appVersion: string;
  preferredPort?: number;
};

interface BrowserHealthMetadata {
  appVersion: string;
  buildFingerprint: string;
  rendererFingerprint: string;
  mainFingerprint: string;
  schema: {
    settings: number;
    effectiveCatalog: number;
    providerCatalog: number;
  };
  catalogRevision: string;
  catalog: {
    source: 'models.dev';
    identityCount: number;
    snapshotSha256: string;
    materializedSurfaceCount: number;
  };
}

let server: Server | null = null;
let bridgeUrl: string | null = null;
let bridgeToken: string | null = null;
let qaBootstrapToken: string | null = null;
let allowedOrigins = new Set<string>();
let healthMetadata: BrowserHealthMetadata | null = null;

const MAX_JSON_BODY_BYTES = 1 * 1024 * 1024;

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function resolveHealthMetadata(options: BridgeOptions): BrowserHealthMetadata {
  const rendererPath = join(options.rendererRoot, 'index.html');
  const rendererFingerprint = sha256(readFileSync(rendererPath));
  const mainFingerprint = sha256(readFileSync(options.mainBundlePath));
  const surfaces = listProviderSummaries();
  const catalogRevision = getProviderCatalogRevision();
  return {
    appVersion: options.appVersion,
    buildFingerprint: sha256(`${options.appVersion}:${mainFingerprint}:${rendererFingerprint}`),
    rendererFingerprint,
    mainFingerprint,
    schema: {
      settings: SETTINGS_SCHEMA_VERSION,
      effectiveCatalog: EFFECTIVE_CATALOG_SCHEMA_VERSION,
      providerCatalog: PROVIDER_CATALOG_SCHEMA_VERSION,
    },
    catalogRevision,
    catalog: {
      source: 'models.dev',
      identityCount: MODELS_DEV_IDENTITY_COUNT,
      snapshotSha256: MODELS_DEV_SNAPSHOT_SHA256,
      materializedSurfaceCount: surfaces.length,
    },
  };
}

function setCors(response: ServerResponse, requestOrigin: string | undefined): void {
  if (requestOrigin && allowedOrigins.has(requestOrigin)) {
    response.setHeader('Access-Control-Allow-Origin', requestOrigin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  requestOrigin?: string,
): void {
  setCors(response, requestOrigin);
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function requireBridgeAuth(request: IncomingMessage, url: URL): boolean {
  if (!bridgeToken) {
    return false;
  }
  // Document navigations have no Authorization header. Accept:
  // 1) Bearer, 2) query rdcBridgeToken|token, 3) cookie from short /qa entry.
  // Glass/Simple Browser often truncates long query tokens → 401 JSON "Pretty-print" white screen.
  const provided = resolveProvidedBridgeToken({
    authorizationHeader: request.headers.authorization,
    url,
    cookieHeader: request.headers.cookie,
  });
  return tokensMatch(bridgeToken, provided);
}

function redirectWithBridgeCookie(
  response: ServerResponse,
  location: string,
  token: string,
): void {
  response.writeHead(302, {
    Location: location,
    'Set-Cookie': buildBridgeAuthCookie(token),
    'Cache-Control': 'no-store',
  });
  response.end();
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
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_JSON_BODY_BYTES) {
      request.destroy();
      throw new Error('PAYLOAD_TOO_LARGE: bridge JSON body exceeds 1 MiB.');
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf-8').trim();
  return text ? JSON.parse(text) : {};
}

function redirectToDevRenderer(
  response: ServerResponse,
  rendererUrl: string,
  bridgeOrigin: string,
  token: string,
): void {
  const target = new URL(rendererUrl);
  target.searchParams.set('rdcBridgeOrigin', bridgeOrigin);
  target.searchParams.set('rdcBridgeToken', token);
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
  const relativePathFromRoot = relative(root, requestedPath);
  const contained = relativePathFromRoot === ''
    || (!relativePathFromRoot.startsWith('..') && !isAbsolute(relativePathFromRoot));
  const filePath = contained && existsSync(requestedPath) && statSync(requestedPath).isFile()
    ? requestedPath
    : fallbackIndex;

  if (!existsSync(filePath)) {
    sendJson(response, 404, { success: false, error: 'Renderer build output not found' });
    return;
  }

  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    'Content-Type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
  };
  // Defense-in-depth for browser/headless /app: match Electron production CSP.
  if (extname(filePath) === '.html') {
    headers['Content-Security-Policy'] = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "style-src-attr 'none'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' http://127.0.0.1:* https://openrouter.ai https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join('; ');
  }
  response.writeHead(200, headers);
  createReadStream(filePath).pipe(response);
}

async function handleRequest(options: BridgeOptions, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestOrigin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;

  if (!request.url) {
    sendJson(response, 400, { success: false, error: 'Missing URL' }, requestOrigin);
    return;
  }

  if (requestOrigin && !isOriginAllowed(requestOrigin, allowedOrigins)) {
    sendJson(response, 403, { success: false, error: 'Origin not allowed' }, undefined);
    return;
  }

  if (request.method === 'OPTIONS') {
    setCors(response, requestOrigin);
    response.writeHead(204);
    response.end();
    return;
  }

  const bridgeOrigin = bridgeUrl ?? 'http://127.0.0.1';
  const url = new URL(request.url, bridgeOrigin);

  // Short QA entry: a one-time out-of-band bootstrap is required before the
  // bearer cookie is minted. A local process can no longer mint a QA session
  // by blindly requesting /qa.
  if (url.pathname === '/qa' && (request.method === 'GET' || request.method === 'HEAD')) {
    const suppliedBootstrap = url.searchParams.get('qaBootstrap');
    if (!bridgeToken || !qaBootstrapToken || !tokensMatch(qaBootstrapToken, suppliedBootstrap)) {
      sendJson(response, 401, { success: false, error: 'QA bootstrap required' }, requestOrigin);
      return;
    }
    qaBootstrapToken = null;
    redirectWithBridgeCookie(response, `${bridgeOrigin}/app`, bridgeToken);
    return;
  }

  // Every non-preflight bridge surface requires the per-run bearer token.
  // /app without auth previously redirected with the token in Location (leak).
  const isPublicAsset = !options.devRendererUrl
    && (url.pathname.startsWith('/assets/') || url.pathname === '/favicon.ico');
  if (!isPublicAsset && !requireBridgeAuth(request, url)) {
    sendJson(response, 401, { success: false, error: 'Unauthorized' }, requestOrigin);
    return;
  }

  // Persist query token into a cookie so a later clean /app navigation still authenticates.
  const queryToken = resolveBridgeQueryToken(url);
  if (queryToken && bridgeToken && tokensMatch(bridgeToken, queryToken)) {
    response.setHeader('Set-Cookie', buildBridgeAuthCookie(bridgeToken));
  }

  if (url.pathname === '/api/settings/providers/catalog' && request.method === 'GET') {
    const catalog = await invokeRegisteredIpcChannel('settings:getProviderCatalog');
    sendJson(response, 200, catalog, requestOrigin);
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
      ...healthMetadata,
    }, requestOrigin);
    return;
  }

  if (url.pathname === '/invoke' && request.method === 'POST') {
    void readJsonBody(request)
      .then(async (body) => {
        const payload = body as { channel?: unknown; args?: unknown };
        if (typeof payload.channel !== 'string') {
          sendJson(response, 400, { success: false, error: 'channel must be a string' }, requestOrigin);
          return;
        }
        if (!isBridgeChannelAllowed(payload.channel)) {
          sendJson(response, 403, {
            success: false,
            error: `Channel not allowed on browser bridge: ${payload.channel}`,
          }, requestOrigin);
          return;
        }
        const args = Array.isArray(payload.args) ? payload.args : [];
        const result = await invokeRegisteredIpcChannel(payload.channel, args);
        sendJson(response, 200, { success: true, result }, requestOrigin);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        sendJson(response, message.startsWith('PAYLOAD_TOO_LARGE') ? 413 : 500, {
          success: false,
          error: message,
        }, requestOrigin);
      });
    return;
  }

  if (url.pathname === '/events' && request.method === 'GET') {
    rendererEventHub.connect(response, requestOrigin && allowedOrigins.has(requestOrigin) ? requestOrigin : undefined);
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
        }, requestOrigin);
        return;
      }
      if (!bridgeToken) {
        sendJson(response, 503, { success: false, error: 'Bridge token unavailable' }, requestOrigin);
        return;
      }
      redirectToDevRenderer(response, options.devRendererUrl, bridgeOrigin, bridgeToken);
      return;
    }
    serveStatic(response, options.rendererRoot, url.pathname);
    return;
  }

  if (!options.devRendererUrl && (url.pathname.startsWith('/assets/') || url.pathname === '/favicon.ico')) {
    serveStatic(response, options.rendererRoot, url.pathname);
    return;
  }

  sendJson(response, 404, { success: false, error: 'Not found' }, requestOrigin);
}

export function shouldStartBrowserAppBridge(): boolean {
  // Desktop must never start the bridge. Browser QA is an explicit opt-in.
  return process.env.RDC_AGENT_BROWSER_QA === '1';
}

export function getBrowserAppBridgeToken(): string | null {
  return bridgeToken;
}

export async function startBrowserAppBridge(options: BridgeOptions): Promise<string> {
  if (server && bridgeUrl) {
    return bridgeUrl;
  }

  if (!shouldStartBrowserAppBridge()) {
    throw new Error('Browser app bridge starts only when RDC_AGENT_BROWSER_QA=1');
  }

  const preferredPort = options.preferredPort ?? Number(process.env.RDC_AGENT_BROWSER_BRIDGE_PORT || 5127);
  healthMetadata = resolveHealthMetadata(options);
  bridgeToken = process.env.RDC_AGENT_BROWSER_BRIDGE_TOKEN?.trim() || createBridgeBearerToken();
  qaBootstrapToken = process.env.RDC_AGENT_BROWSER_QA_BOOTSTRAP?.trim() || createBridgeBearerToken();
  process.env.RDC_AGENT_BROWSER_BRIDGE_TOKEN = bridgeToken;

  server = createServer((request, response) => {
    void handleRequest(options, request, response).catch((error) => {
      const requestOrigin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
      sendJson(response, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }, requestOrigin);
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
  allowedOrigins = resolveBridgeAllowedOrigins(bridgeUrl, options.devRendererUrl);
  (globalThis as typeof globalThis & {
    __RDC_AGENT_BROWSER_BRIDGE_URL__?: string;
    __RDC_AGENT_BROWSER_BRIDGE_TOKEN__?: string;
  }).__RDC_AGENT_BROWSER_BRIDGE_URL__ = bridgeUrl;
  (globalThis as typeof globalThis & {
    __RDC_AGENT_BROWSER_BRIDGE_TOKEN__?: string;
  }).__RDC_AGENT_BROWSER_BRIDGE_TOKEN__ = bridgeToken;

  const bootstrap = qaBootstrapToken;
  if (!bootstrap) {
    throw new Error('QA bootstrap token was not initialized');
  }
  const qaUrl = `${bridgeUrl}/qa?qaBootstrap=${encodeURIComponent(bootstrap)}`;
  const appUrl = `${bridgeUrl}/app?rdcBridgeToken=${encodeURIComponent(bridgeToken)}`;
  console.log(`[BrowserAppBridge] Browser app session: ${qaUrl}`);
  console.log(`[BrowserAppBridge] Direct /app URL (fallback): ${appUrl}`);
  return bridgeUrl;
}

export async function stopBrowserAppBridge(): Promise<void> {
  const activeServer = server;
  server = null;
  bridgeUrl = null;
  bridgeToken = null;
  qaBootstrapToken = null;
  allowedOrigins = new Set();
  healthMetadata = null;
  delete (globalThis as typeof globalThis & { __RDC_AGENT_BROWSER_BRIDGE_URL__?: string }).__RDC_AGENT_BROWSER_BRIDGE_URL__;
  delete (globalThis as typeof globalThis & { __RDC_AGENT_BROWSER_BRIDGE_TOKEN__?: string }).__RDC_AGENT_BROWSER_BRIDGE_TOKEN__;
  if (!activeServer) {
    return;
  }
  await new Promise<void>((resolveClose) => activeServer.close(() => resolveClose()));
}
