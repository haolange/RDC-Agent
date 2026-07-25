import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Lightweight contract tests for /qa cookie entry and auth fail-closed JSON.
 * Uses the same auth helpers as BrowserAppBridgeServer without booting Electron.
 */

vi.mock('../ipc/invokeRegistry', () => ({
  hasRegisteredIpcChannel: () => true,
  invokeRegisteredIpcChannel: async () => ({}),
}));

import {
  buildBridgeAuthCookie,
  resolveProvidedBridgeToken,
  tokensMatch,
} from './bridgeSecurity';

const EXPECTED = 'a'.repeat(64);

function createMinimalQaServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolveListen, reject) => {
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname === '/qa' && (request.method === 'GET' || request.method === 'HEAD')) {
        response.writeHead(302, {
          Location: '/app',
          'Set-Cookie': buildBridgeAuthCookie(EXPECTED),
          'Cache-Control': 'no-store',
        });
        response.end();
        return;
      }
      if (url.pathname === '/app') {
        const provided = resolveProvidedBridgeToken({
          authorizationHeader: request.headers.authorization,
          url,
          cookieHeader: request.headers.cookie,
        });
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

    const qaResponse = await fetch(`${started.baseUrl}/qa`, { redirect: 'manual' });
    expect(qaResponse.status).toBe(302);
    expect(qaResponse.headers.get('location')).toBe('/app');
    const setCookie = qaResponse.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('rdcBridgeToken=');

    const cookie = setCookie.split(';')[0] ?? '';
    const appResponse = await fetch(`${started.baseUrl}/app`, {
      headers: { Cookie: cookie },
    });
    expect(appResponse.status).toBe(200);
    expect(appResponse.headers.get('content-type')).toMatch(/text\/html/);
    const body = await appResponse.text();
    expect(body).toContain('Workbench');
    expect(body.trimStart().startsWith('{')).toBe(false);
  });

  it('GET /app without cookie or token returns 401 JSON', async () => {
    const started = await createMinimalQaServer();
    server = started.server;

    const response = await fetch(`${started.baseUrl}/app`);
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    const payload = await response.json() as { success: boolean; error: string };
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('Unauthorized');
  });

  it('truncated / mismatched token returns 401 JSON (not HTML workbench)', async () => {
    const started = await createMinimalQaServer();
    server = started.server;

    const response = await fetch(
      `${started.baseUrl}/app?rdcBridgeToken=${EXPECTED.slice(0, 16)}`,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    const text = await response.text();
    expect(() => JSON.parse(text)).not.toThrow();
    expect(text).not.toContain('<!doctype');
  });
});
