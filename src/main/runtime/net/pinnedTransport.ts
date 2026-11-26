import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import type { LookupFunction } from 'net';
import type { PinnedPublicHttpUrl } from './publicAddress';

export type PinnedFetchInit = {
  /** Enforced while receiving, before buffering the complete response. */
  maxResponseBytes: number;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | null;
  signal?: AbortSignal;
  redirect?: 'manual' | 'error' | 'follow';
};

/**
 * Connects to the already-verified pinned address while sending the original Host (and TLS servername), so DNS
 * rebinding cannot retarget the TCP connection. The body is buffered under `maxResponseBytes` before resolving.
 */
export async function requestPinned(
  pinned: PinnedPublicHttpUrl,
  init: PinnedFetchInit,
): Promise<Response> {
  if (!Number.isSafeInteger(init.maxResponseBytes) || init.maxResponseBytes <= 0) {
    throw new Error('Pinned HTTP response byte limit must be a positive safe integer.');
  }
  const url = new URL(pinned.href);
  const isHttps = pinned.protocol === 'https:';
  const lib = isHttps ? https : http;
  const defaultPort = isHttps ? 443 : 80;
  const port = url.port ? Number(url.port) : defaultPort;
  const allowed = new Set(pinned.pinnedAddresses);
  const lookupPinned: LookupFunction = (_hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    if (typeof cb !== 'function') return;
    const wantAll = typeof options === 'object' && 'all' in options && options.all;
    if (wantAll) {
      (cb as (err: NodeJS.ErrnoException | null, addresses: Array<{ address: string; family: number }>) => void)(
        null,
        pinned.pinnedAddresses.map((address) => ({
          address,
          family: net.isIP(address) === 6 ? 6 : 4,
        })),
      );
      return;
    }
    (cb as (err: NodeJS.ErrnoException | null, address: string, family: number) => void)(
      null,
      pinned.pinnedAddress,
      pinned.family,
    );
  };

  return new Promise<Response>((resolve, reject) => {
    const headers: Record<string, string> = {
      ...(init.headers ?? {}),
      Host: url.host,
    };
    const request = lib.request(
      {
        protocol: pinned.protocol,
        hostname: pinned.pinnedAddress,
        port,
        path: `${url.pathname}${url.search}`,
        method: init.method ?? 'GET',
        headers,
        lookup: lookupPinned,
        servername: isHttps ? pinned.hostname : undefined,
        setHost: false,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        let exceeded = false;
        incoming.on('data', (chunk: Buffer) => {
          if (exceeded) return;
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          receivedBytes += bytes.length;
          if (receivedBytes > init.maxResponseBytes) {
            exceeded = true;
            chunks.length = 0;
            const error = new Error(`Public response exceeds the ${init.maxResponseBytes} byte source limit.`);
            incoming.destroy(error);
            request.destroy(error);
            reject(error);
            return;
          }
          chunks.push(bytes);
        });
        incoming.on('end', () => {
          if (exceeded) return;
          const body = Buffer.concat(chunks);
          const headerEntries: [string, string][] = [];
          for (const [key, value] of Object.entries(incoming.headers)) {
            if (value === undefined) continue;
            headerEntries.push([key, Array.isArray(value) ? value.join(', ') : value]);
          }
          resolve(new Response(body, {
            status: incoming.statusCode ?? 0,
            statusText: incoming.statusMessage ?? '',
            headers: headerEntries,
          }));
        });
        incoming.on('error', reject);
      },
    );
    request.on('error', reject);
    if (init.signal) {
      if (init.signal.aborted) {
        request.destroy(new Error('Request aborted'));
        reject(init.signal.reason instanceof Error ? init.signal.reason : new Error('Request aborted'));
        return;
      }
      const onAbort = (): void => {
        request.destroy(new Error('Request aborted'));
      };
      init.signal.addEventListener('abort', onAbort, { once: true });
      request.on('close', () => init.signal?.removeEventListener('abort', onAbort));
    }
    // Guard: refuse if somehow not in allowlist (defense in depth).
    if (!allowed.has(pinned.pinnedAddress)) {
      reject(new Error(`Pinned address not in verified set: ${pinned.pinnedAddress}`));
      return;
    }
    if (init.body) {
      request.write(init.body);
    }
    request.end();
  });
}
