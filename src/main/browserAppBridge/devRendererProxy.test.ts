import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isBridgeOwnedPath,
  mapDevRendererProxyPath,
  proxyHttpToDevRenderer,
  shouldProxyToDevRenderer,
  copyDevRendererUpstreamHeaders,
} from './devRendererProxy';

describe('devRendererProxy path mapping', () => {
  it('maps /app onto Vite root and preserves Vite absolute paths', () => {
    expect(mapDevRendererProxyPath('/app')).toBe('/');
    expect(mapDevRendererProxyPath('/app/')).toBe('/');
    expect(mapDevRendererProxyPath('/app/', '?qaPerformance=1')).toBe('/?qaPerformance=1');
    expect(mapDevRendererProxyPath('/app/src/main.tsx')).toBe('/src/main.tsx');
    expect(mapDevRendererProxyPath('/@vite/client')).toBe('/@vite/client');
    expect(mapDevRendererProxyPath('/node_modules/.vite/deps/react.js')).toBe('/node_modules/.vite/deps/react.js');
  });

  it('never proxies bridge-owned API surfaces', () => {
    expect(isBridgeOwnedPath('/invoke')).toBe(true);
    expect(isBridgeOwnedPath('/events')).toBe(true);
    expect(isBridgeOwnedPath('/health')).toBe(true);
    expect(isBridgeOwnedPath('/qa')).toBe(true);
    expect(isBridgeOwnedPath('/api/settings/providers/catalog')).toBe(true);
    expect(shouldProxyToDevRenderer('/app', 'http://127.0.0.1:5173')).toBe(true);
    expect(shouldProxyToDevRenderer('/invoke', 'http://127.0.0.1:5173')).toBe(false);
    expect(shouldProxyToDevRenderer('/app', null)).toBe(false);
  });
});

describe('devRendererProxy upstream header stripping', () => {
  it('strips cookie, authorization, and x-rdc-* before forwarding to Vite', () => {
    const headers = copyDevRendererUpstreamHeaders(
      {
        headers: {
          host: '127.0.0.1:5127',
          cookie: 'rdcBridgeToken=SECRET',
          authorization: 'Bearer SECRET',
          'proxy-authorization': 'Basic SECRET',
          'x-rdc-debug': 'nope',
          accept: 'text/html',
        },
      } as unknown as IncomingMessage,
      '127.0.0.1:5173',
    );
    expect(headers.host).toBe('127.0.0.1:5173');
    expect(headers.cookie).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
    expect(headers['proxy-authorization']).toBeUndefined();
    expect(headers['x-rdc-debug']).toBeUndefined();
    expect(headers.accept).toBe('text/html');
  });
});

describe('devRendererProxy HTTP reverse proxy', () => {
  let upstream: ReturnType<typeof createServer> | null = null;
  let bridge: ReturnType<typeof createServer> | null = null;

  afterEach(async () => {
    await Promise.all([
      upstream ? new Promise<void>((resolve) => upstream!.close(() => resolve())) : Promise.resolve(),
      bridge ? new Promise<void>((resolve) => bridge!.close(() => resolve())) : Promise.resolve(),
    ]);
    upstream = null;
    bridge = null;
  });

  it('proxies /app to Vite / without redirecting the browser off bridge origin', async () => {
    upstream = createServer((request: IncomingMessage, response: ServerResponse) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<html><body>vite:${request.url}</body></html>`);
    });
    await new Promise<void>((resolve, reject) => {
      upstream!.once('error', reject);
      upstream!.listen(0, '127.0.0.1', () => resolve());
    });
    const upstreamPort = (upstream.address() as AddressInfo).port;
    const devRendererUrl = `http://127.0.0.1:${upstreamPort}`;

    bridge = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      proxyHttpToDevRenderer(request, response, {
        bridgeOrigin: 'http://127.0.0.1:5127',
        devRendererUrl,
        pathname: url.pathname,
        search: url.search,
      });
    });
    await new Promise<void>((resolve, reject) => {
      bridge!.once('error', reject);
      bridge!.listen(0, '127.0.0.1', () => resolve());
    });
    const bridgePort = (bridge.address() as AddressInfo).port;

    const response = await fetch(`http://127.0.0.1:${bridgePort}/app`);
    expect(response.status).toBe(200);
    expect(response.url).toContain(`127.0.0.1:${bridgePort}`);
    expect(await response.text()).toContain('vite:/');
  });
});
