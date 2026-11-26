import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { rendererEventHub } from '../runtime/rendererEventHub';
import { buildBridgeAuthCookie, extractBearerToken, resolveBridgeCookieToken, tokensMatch } from './bridgeSecurity';
import { startBrowserAppBridge, stopBrowserAppBridge } from './BrowserAppBridgeServer';
import type { AddressInfo } from 'net';

/**
 * Lightweight contract tests for /qa cookie entry and auth fail-closed JSON.
 * Uses the same auth helpers as BrowserAppBridgeServer without booting Electron.
 */

vi.mock('../ipc/invokeRegistry', () => ({
  hasRegisteredIpcChannel: () => true,
  invokeRegisteredIpcChannel: async () => ({}),
}));
vi.mock('../runtime/browserQaRun', () => ({ isBrowserQaRun: () => true }));
vi.mock('../conversation/AttachmentStagingService', () => ({ attachmentStagingService: { clearAll: () => {} } }));
vi.mock('../provider-catalog/ProviderCatalogRegistry', () => ({
  getProviderCatalogRevision: () => 'test-catalog',
  listProviderSummaries: () => [],
}));

const EXPECTED = 'a'.repeat(64);

function createMinimalQaServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolveListen, reject) => {
    let bootstrapToken: string | null = 'qa-bootstrap';
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const url = new URL(request.url ?? '/', origin);
      if (url.pathname === '/qa' && (request.method === 'GET' || request.method === 'HEAD')) {
        if (!bootstrapToken || url.searchParams.get('qaBootstrap') !== bootstrapToken) {
          response.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ success: false, error: 'QA bootstrap required' }));
          return;
        }
        bootstrapToken = null;
        response.writeHead(302, {
          Location: '/app',
          'Set-Cookie': buildBridgeAuthCookie(EXPECTED, origin),
          'Cache-Control': 'no-store',
        });
        response.end();
        return;
      }
      if (url.pathname === '/app') {
        const provided =
          extractBearerToken(request.headers.authorization) ?? resolveBridgeCookieToken(request.headers.cookie, origin);
        if (!tokensMatch(EXPECTED, provided)) {
          response.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
          return;
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<!doctype html><html><body>Workbench</body></html>');
        return;
      }
      response.writeHead(404);
      response.end();
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolveListen({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

describe('BrowserAppBridge /qa auth contract', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (!server) return;
    await new Promise<void>((resolveClose) => server!.close(() => resolveClose()));
    server = null;
  });

  it('GET /qa redirects with Set-Cookie and /app with cookie returns HTML', async () => {
    const started = await createMinimalQaServer();
    server = started.server;

    const qaResponse = await fetch(`${started.baseUrl}/qa?qaBootstrap=qa-bootstrap`, { redirect: 'manual' });
    expect(qaResponse.status).toBe(302);
    expect(qaResponse.headers.get('location')).toBe('/app');
    const setCookie = qaResponse.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`rdcBridgeToken-${new URL(started.baseUrl).port}=`);

    const cookie = setCookie.split(';')[0] ?? '';
    const appResponse = await fetch(`${started.baseUrl}/app`, {
      headers: { Cookie: cookie },
    });
    expect(appResponse.status).toBe(200);
    expect(appResponse.headers.get('content-type')).toMatch(/text\/html/);
    const body = await appResponse.text();
    expect(body).toContain('Workbench');
    expect(body.trimStart().startsWith('{')).toBe(false);

    const replay = await fetch(`${started.baseUrl}/qa?qaBootstrap=qa-bootstrap`, { redirect: 'manual' });
    expect(replay.status).toBe(401);
  });

  it('GET /app without cookie or token returns 401 JSON', async () => {
    const started = await createMinimalQaServer();
    server = started.server;

    const response = await fetch(`${started.baseUrl}/app`);
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    const payload = (await response.json()) as { success: boolean; error: string };
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('Unauthorized');
  });

  it('URL token is not accepted and returns 401 JSON (not HTML workbench)', async () => {
    const started = await createMinimalQaServer();
    server = started.server;

    const response = await fetch(`${started.baseUrl}/app?rdcBridgeToken=${EXPECTED}`);
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    const text = await response.text();
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).not.toContain('<!doctype');
  });
});

it('closes the real bridge while an authenticated browser is still subscribed to events', async () => {
  const root = await mkdtemp(join(tmpdir(), 'browser-bridge-close-'));
  const mainBundlePath = join(root, 'entry.js');
  const bootstrap = 'bridge-close-test';
  vi.stubEnv('RDC_AGENT_BROWSER_QA_BOOTSTRAP', bootstrap);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  let stop: Promise<void> | undefined;
  let client: AbortController | undefined;
  try {
    await Promise.all([writeFile(join(root, 'index.html'), '<html></html>'), writeFile(mainBundlePath, 'export {};')]);
    const origin = await startBrowserAppBridge({
      devRendererUrl: null,
      rendererRoot: root,
      mainBundlePath,
      appVersion: 'test',
      preferredPort: 0,
    });
    const entry = await fetch(`${origin}/qa?qaBootstrap=${bootstrap}`, { redirect: 'manual' });
    const cookie = entry.headers.get('set-cookie')?.split(';')[0] ?? '';
    client = new AbortController();
    const events = await fetch(`${origin}/events`, {
      method: 'POST',
      headers: { Cookie: cookie, Origin: origin },
      signal: client.signal,
    });
    expect(events.status).toBe(200);
    expect(rendererEventHub.hasClients()).toBe(true);

    let closed = false;
    stop = stopBrowserAppBridge().then(() => {
      closed = true;
    });
    await vi.waitFor(() => expect(closed).toBe(true));
    expect(rendererEventHub.hasClients()).toBe(false);
  } finally {
    client?.abort();
    await (stop ?? stopBrowserAppBridge());
    log.mockRestore();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
