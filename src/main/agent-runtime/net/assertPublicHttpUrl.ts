import { lookup } from 'dns/promises';
import * as http from 'http';
import * as https from 'https';
import * as net from 'net';
import type { LookupFunction } from 'net';

export interface PinnedPublicHttpUrl {
  href: string;
  hostname: string;
  protocol: 'http:' | 'https:';
  port: string;
  pinnedAddress: string;
  family: 4 | 6;
  /** All verified public addresses from the pre-connect lookup. */
  pinnedAddresses: string[];
}

/**
 * Validate URL + DNS, then return a pinned public address for connect-time use.
 * Callers must connect via `fetchPinnedPublic` (or equivalent) to close DNS TOCTOU.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<PinnedPublicHttpUrl> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked non-HTTP URL: ${parsed.protocol}`);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error(`Blocked local host: ${hostname || '(empty)'}`);
  }
  if (isPrivateIp(hostname)) {
    throw new Error(`Blocked private network address: ${hostname}`);
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch (error) {
    throw new Error(
      `DNS lookup failed for ${hostname}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (addresses.length === 0) {
    throw new Error(`DNS lookup returned no addresses for ${hostname}`);
  }
  const publicAddresses = addresses.filter((entry) => !isPrivateIp(entry.address));
  if (publicAddresses.length === 0) {
    throw new Error(`Blocked private network address: ${addresses[0].address}`);
  }
  for (const address of addresses) {
    if (isPrivateIp(address.address)) {
      // Fail closed if ANY resolved address is private (mixed dual-stack risk).
      throw new Error(`Blocked private network address: ${address.address}`);
    }
  }
  const primary = publicAddresses[0];
  const family: 4 | 6 = primary.family === 6 ? 6 : 4;
  return {
    href: parsed.toString(),
    hostname: parsed.hostname,
    protocol: parsed.protocol as 'http:' | 'https:',
    port: parsed.port,
    pinnedAddress: primary.address,
    family,
    pinnedAddresses: publicAddresses.map((entry) => entry.address),
  };
}

export type PinnedFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer | null;
  signal?: AbortSignal;
  redirect?: 'manual' | 'error' | 'follow';
};

/**
 * Connect using the already-verified pinned IP while sending the original Host
 * (and TLS servername) so DNS rebinding cannot retarget the TCP connection.
 */
export async function fetchPinnedPublic(
  pinned: PinnedPublicHttpUrl,
  init: PinnedFetchInit = {},
): Promise<Response> {
  const url = new URL(pinned.href);
  const isHttps = pinned.protocol === 'https:';
  const lib = isHttps ? https : http;
  const defaultPort = isHttps ? 443 : 80;
  const port = url.port ? Number(url.port) : defaultPort;
  const allowed = new Set(pinned.pinnedAddresses);
  const lookupPinned: LookupFunction = (_hostname, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    if (typeof cb !== 'function') return;
    const wantAll = typeof options === 'object' && options && 'all' in options && options.all;
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
        incoming.on('data', (chunk: Buffer) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        incoming.on('end', () => {
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

function isPrivateIp(value: string): boolean {
  const ipVersion = net.isIP(value);
  if (ipVersion === 4) {
    return isPrivateIpv4(value);
  }
  if (ipVersion === 6) {
    const normalized = value.toLowerCase();
    if (
      normalized === '::1'
      || normalized === '::'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe80:')
    ) {
      return true;
    }
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) {
      return isPrivateIpv4(mapped[1]);
    }
    const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = Number.parseInt(mappedHex[1], 16);
      const lo = Number.parseInt(mappedHex[2], 16);
      const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateIpv4(ipv4);
    }
    return false;
  }
  return false;
}

function isPrivateIpv4(value: string): boolean {
  const parts = value.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return true;
  const [a, b] = parts;
  return (
    a === 0
    || a === 10
    || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a >= 224
  );
}
