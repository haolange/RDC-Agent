/**
 * Same-origin reverse proxy from BrowserAppBridge → Vite (browser-dev).
 * Keeps the browser on the bridge origin so HttpOnly cookies never cross ports.
 */

import {
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

/** Map bridge request path onto the Vite server path space. */
export function mapDevRendererProxyPath(pathname: string, search = ''): string {
  if (pathname === '/app' || pathname === '/app/') {
    return `/${search}`;
  }
  if (pathname.startsWith('/app/')) {
    return `${pathname.slice('/app'.length)}${search}`;
  }
  return `${pathname}${search}`;
}

/** True when the path is a bridge-owned API surface (never proxied). */
export function isBridgeOwnedPath(pathname: string): boolean {
  return pathname === '/qa'
    || pathname === '/invoke'
    || pathname === '/events'
    || pathname === '/health'
    || pathname.startsWith('/api/');
}

export function shouldProxyToDevRenderer(
  pathname: string,
  devRendererUrl: string | null | undefined,
): boolean {
  return Boolean(devRendererUrl) && !isBridgeOwnedPath(pathname);
}

function copyRequestHeaders(source: IncomingMessage, targetHost: string): Record<string, string | string[] | undefined> {
  const headers: Record<string, string | string[] | undefined> = { ...source.headers, host: targetHost };
  for (const key of Object.keys(headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase())) {
      delete headers[key];
    }
  }
  return headers;
}

export function proxyHttpToDevRenderer(
  request: IncomingMessage,
  response: ServerResponse,
  input: {
    bridgeOrigin: string;
    devRendererUrl: string;
    pathname: string;
    search: string;
  },
): void {
  const targetBase = new URL(input.devRendererUrl);
  const mappedPath = mapDevRendererProxyPath(input.pathname, input.search);
  const requestImpl = targetBase.protocol === 'https:' ? httpsRequest : httpRequest;
  const upstream = requestImpl(
    {
      protocol: targetBase.protocol,
      hostname: targetBase.hostname,
      port: targetBase.port || (targetBase.protocol === 'https:' ? '443' : '80'),
      method: request.method,
      path: mappedPath,
      headers: copyRequestHeaders(request, targetBase.host),
      timeout: 30_000,
    },
    (upstreamResponse) => {
      const headers: Record<string, string | string[] | number | undefined> = {};
      for (const [key, value] of Object.entries(upstreamResponse.headers)) {
        if (HOP_BY_HOP.has(key.toLowerCase())) continue;
        headers[key] = value;
      }
      // Page stays on the bridge origin; never advertise Vite's private origin.
      headers['cache-control'] = headers['cache-control'] ?? 'no-store';
      response.writeHead(upstreamResponse.statusCode ?? 502, headers);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on('timeout', () => {
    upstream.destroy(new Error('Dev renderer proxy timed out'));
  });
  upstream.on('error', (error) => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      success: false,
      error: `Dev renderer proxy failed: ${error.message}`,
      bridgeOrigin: input.bridgeOrigin,
      devRendererUrl: input.devRendererUrl,
    }));
  });

  request.pipe(upstream);
}

export function attachDevRendererWebSocketProxy(
  server: Server,
  resolveDevRendererUrl: () => string | null,
): void {
  server.on('upgrade', (request, socket, head) => {
    const devRendererUrl = resolveDevRendererUrl();
    if (!devRendererUrl || !request.url) {
      socket.destroy();
      return;
    }
    const bridgeOrigin = `http://${request.headers.host ?? '127.0.0.1'}`;
    let pathname = '/';
    let search = '';
    try {
      const parsed = new URL(request.url, bridgeOrigin);
      pathname = parsed.pathname;
      search = parsed.search;
    } catch {
      socket.destroy();
      return;
    }
    if (isBridgeOwnedPath(pathname)) {
      socket.destroy();
      return;
    }

    const targetBase = new URL(devRendererUrl);
    const mappedPath = mapDevRendererProxyPath(pathname, search);
    const upstream = httpRequest({
      protocol: targetBase.protocol,
      hostname: targetBase.hostname,
      port: targetBase.port || '80',
      method: 'GET',
      path: mappedPath,
      headers: {
        ...copyRequestHeaders(request, targetBase.host),
        connection: 'Upgrade',
        upgrade: request.headers.upgrade ?? 'websocket',
      },
    });

    upstream.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
      const lines = [
        `HTTP/1.1 ${upstreamResponse.statusCode ?? 101} Switching Protocols`,
      ];
      for (const [key, value] of Object.entries(upstreamResponse.headers)) {
        if (value == null) continue;
        if (Array.isArray(value)) {
          for (const item of value) lines.push(`${key}: ${item}`);
        } else {
          lines.push(`${key}: ${value}`);
        }
      }
      lines.push('', '');
      socket.write(lines.join('\r\n'));
      if (upstreamHead.length > 0) socket.write(upstreamHead);
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
    });

    upstream.on('error', () => {
      socket.destroy();
    });
    socket.on('error', () => {
      upstream.destroy();
    });

    if (head.length > 0) upstream.write(head);
    upstream.end();
  });
}
