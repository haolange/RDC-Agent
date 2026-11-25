import { lookup } from 'dns/promises';
import * as net from 'net';
import { AppError } from '@shared/errors/appError';

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

/** The URL, or an address it resolves to, is not a public HTTP target. No request was sent. */
export class PublicUrlDeniedError extends AppError {
  constructor(detail: string) {
    super('EXTERNAL_URL_REJECTED', detail);
    this.name = 'PublicUrlDeniedError';
  }
}

interface AddressRange {
  network: bigint;
  bits: number;
}

interface EmbeddedIpv4Range extends AddressRange {
  /** Bit offset, from the most significant end of the 128-bit address, where the embedded IPv4 address starts. */
  ipv4Offset: number;
}

const ipv4 = (cidr: string): AddressRange => {
  const [address, bits] = cidr.split('/');
  return { network: ipv4ToBigInt(address), bits: Number(bits) };
};

const ipv6 = (cidr: string): AddressRange => {
  const [address, bits] = cidr.split('/');
  return { network: ipv6ToBigInt(address), bits: Number(bits) };
};

/** IPv4 space that is not globally routable unicast (RFC 6890 special-purpose registry, plus multicast and reserved). */
const NON_PUBLIC_IPV4: readonly AddressRange[] = [
  '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24',
  '192.0.2.0/24', '192.88.99.0/24', '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24',
  '224.0.0.0/4', '240.0.0.0/4',
].map(ipv4);

/** IPv6 forms that carry an IPv4 address; the embedded address decides. */
const EMBEDDED_IPV4_IPV6: readonly EmbeddedIpv4Range[] = [
  { ...ipv6('::ffff:0:0/96'), ipv4Offset: 96 },
  { ...ipv6('::/96'), ipv4Offset: 96 },
  { ...ipv6('64:ff9b::/96'), ipv4Offset: 96 },
  { ...ipv6('2002::/16'), ipv4Offset: 16 },
];

const GLOBAL_UNICAST_IPV6 = ipv6('2000::/3');

/** Inside global unicast, but documentation or local-use space. Outside 2000::/3 nothing is public. */
const NON_PUBLIC_GLOBAL_IPV6: readonly AddressRange[] = ['2001:db8::/32', '3fff::/20'].map(ipv6);

function ipv4ToBigInt(address: string): bigint {
  return address.split('.').reduce((value, octet) => (value << 8n) | BigInt(Number(octet)), 0n);
}

function ipv6ToBigInt(address: string): bigint {
  let text = address.toLowerCase().split('%')[0];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/u.exec(text);
  if (dotted) {
    const value = ipv4ToBigInt(dotted[1]);
    text = `${text.slice(0, -dotted[1].length)}${(value >> 16n).toString(16)}:${(value & 0xffffn).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const groups = tail === undefined
    ? headGroups
    : [...headGroups, ...Array<string>(8 - headGroups.length - tailGroups.length).fill('0'), ...tailGroups];
  return groups.reduce((value, group) => (value << 16n) | BigInt(Number.parseInt(group, 16)), 0n);
}

function inRange(value: bigint, width: number, range: AddressRange): boolean {
  const shift = BigInt(width - range.bits);
  return value >> shift === range.network >> shift;
}

/** True only for a globally routable unicast address; anything unparseable is not public. */
export function isPublicAddress(address: string): boolean {
  const literal = address.replace(/^\[|\]$/gu, '');
  const version = net.isIP(literal);
  if (version === 4) {
    const value = ipv4ToBigInt(literal);
    return !NON_PUBLIC_IPV4.some((range) => inRange(value, 32, range));
  }
  if (version !== 6) return false;
  const value = ipv6ToBigInt(literal);
  const embedded = EMBEDDED_IPV4_IPV6.find((range) => inRange(value, 128, range));
  if (embedded) {
    const embeddedValue = (value >> BigInt(128 - embedded.ipv4Offset - 32)) & 0xffffffffn;
    return !NON_PUBLIC_IPV4.some((range) => inRange(embeddedValue, 32, range));
  }
  return inRange(value, 128, GLOBAL_UNICAST_IPV6) && !NON_PUBLIC_GLOBAL_IPV6.some((range) => inRange(value, 128, range));
}

/**
 * Validates the URL and resolves its host, then returns a pinned public address for the connection. Every resolved
 * address must be public, so a mixed dual-stack answer cannot slip a private address in. Connect only through
 * `requestPinned` so the TCP connection goes to the verified address, closing the DNS rebinding window.
 */
export async function pinPublicUrl(rawUrl: string, options: { httpsOnly?: boolean } = {}): Promise<PinnedPublicHttpUrl> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new PublicUrlDeniedError(`Invalid URL: ${rawUrl}`);
  }
  const allowedProtocols = options.httpsOnly ? ['https:'] : ['http:', 'https:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new PublicUrlDeniedError(`Blocked non-HTTP${options.httpsOnly ? 'S' : ''} URL: ${parsed.protocol}`);
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/u, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new PublicUrlDeniedError(`Blocked local host: ${hostname || '(empty)'}`);
  }
  const literal = hostname.replace(/^\[|\]$/gu, '');
  if (net.isIP(literal) && !isPublicAddress(literal)) {
    throw new PublicUrlDeniedError(`Blocked private network address: ${literal}`);
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(literal, { all: true });
  } catch (error) {
    throw new PublicUrlDeniedError(`DNS lookup failed for ${hostname}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (addresses.length === 0) throw new PublicUrlDeniedError(`DNS lookup returned no addresses for ${hostname}`);
  const blocked = addresses.find((entry) => !isPublicAddress(entry.address));
  if (blocked) throw new PublicUrlDeniedError(`Blocked private network address: ${blocked.address}`);
  const [primary] = addresses;
  return {
    href: parsed.toString(),
    hostname: parsed.hostname,
    protocol: parsed.protocol as 'http:' | 'https:',
    port: parsed.port,
    pinnedAddress: primary.address,
    family: primary.family === 6 ? 6 : 4,
    pinnedAddresses: addresses.map((entry) => entry.address),
  };
}
