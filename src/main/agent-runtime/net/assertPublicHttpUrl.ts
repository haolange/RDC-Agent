import { lookup } from 'dns/promises';
import * as net from 'net';

export async function assertPublicHttpUrl(rawUrl: string): Promise<string> {
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
  let addresses: Array<{ address: string }>;
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
  for (const address of addresses) {
    if (isPrivateIp(address.address)) {
      throw new Error(`Blocked private network address: ${address.address}`);
    }
  }
  return parsed.toString();
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
