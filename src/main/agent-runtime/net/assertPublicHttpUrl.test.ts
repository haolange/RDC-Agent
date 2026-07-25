import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LookupAddress } from 'dns';

vi.mock('dns/promises', () => ({
  lookup: vi.fn(),
}));

import { lookup } from 'dns/promises';
import { assertPublicHttpUrl, fetchPinnedPublic } from './assertPublicHttpUrl';
import * as http from 'http';

/** `vi.mocked(lookup)` binds the single-address overload; cast arrays for `{ all: true }`. */
function mockLookupAddresses(addresses: LookupAddress[]): void {
  vi.mocked(lookup).mockResolvedValueOnce(addresses as unknown as LookupAddress);
}

describe('assertPublicHttpUrl', () => {
  afterEach(() => {
    vi.mocked(lookup).mockReset();
  });

  it('rejects invalid and non-http URLs', async () => {
    await expect(assertPublicHttpUrl('not a url')).rejects.toThrow(/Invalid URL/);
    await expect(assertPublicHttpUrl('ftp://example.com')).rejects.toThrow(/Blocked non-HTTP/);
  });

  it('rejects localhost and literal private IPs', async () => {
    await expect(assertPublicHttpUrl('http://localhost/x')).rejects.toThrow(/Blocked local host/);
    await expect(assertPublicHttpUrl('http://app.localhost/x')).rejects.toThrow(/Blocked local host/);
    await expect(assertPublicHttpUrl('http://127.0.0.1/x')).rejects.toThrow(/Blocked private/);
    await expect(assertPublicHttpUrl('http://0.0.0.0/x')).rejects.toThrow(/Blocked private/);
    await expect(assertPublicHttpUrl('http://10.0.0.1/x')).rejects.toThrow(/Blocked private/);
    await expect(assertPublicHttpUrl('http://192.168.1.1/x')).rejects.toThrow(/Blocked private/);
    await expect(assertPublicHttpUrl('http://172.16.0.1/x')).rejects.toThrow(/Blocked private/);
    await expect(assertPublicHttpUrl('http://169.254.1.1/x')).rejects.toThrow(/Blocked private/);
    await expect(assertPublicHttpUrl('http://224.0.0.1/x')).rejects.toThrow(/Blocked private/);
  });

  it('rejects private IPv6 resolutions from DNS', async () => {
    for (const address of ['::1', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
      mockLookupAddresses([{ address, family: 6 }]);
      await expect(assertPublicHttpUrl('https://ipv6-private.example')).rejects.toThrow(/Blocked private/);
    }
  });

  it('rejects DNS failures and private resolutions', async () => {
    vi.mocked(lookup).mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(assertPublicHttpUrl('https://missing.example')).rejects.toThrow(/DNS lookup failed/);

    mockLookupAddresses([]);
    await expect(assertPublicHttpUrl('https://empty.example')).rejects.toThrow(/no addresses/);

    mockLookupAddresses([{ address: '10.1.2.3', family: 4 }]);
    await expect(assertPublicHttpUrl('https://private.example')).rejects.toThrow(/Blocked private/);

    mockLookupAddresses([
      { address: '1.2.3.4', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);
    await expect(assertPublicHttpUrl('https://mixed.example')).rejects.toThrow(/Blocked private/);
  });

  it('pins a public IPv4 address', async () => {
    mockLookupAddresses([{ address: '1.2.3.4', family: 4 }]);
    const pinned = await assertPublicHttpUrl('https://example.com:8443/path?q=1');
    expect(pinned).toMatchObject({
      hostname: 'example.com',
      protocol: 'https:',
      port: '8443',
      pinnedAddress: '1.2.3.4',
      family: 4,
    });
    expect(pinned.pinnedAddresses).toEqual(['1.2.3.4']);
  });

  it('pins a public IPv6 address', async () => {
    mockLookupAddresses([{ address: '2001:db8::1', family: 6 }]);
    const pinned = await assertPublicHttpUrl('http://ipv6.example/');
    expect(pinned.family).toBe(6);
    expect(pinned.pinnedAddress).toBe('2001:db8::1');
  });

  it('fetchPinnedPublic performs a pinned HTTP request', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close();
      throw new Error('expected TCP address');
    }
    try {
      // Use loopback only inside fetchPinnedPublic after assert already pinned a public IP.
      // Here we simulate a pinned public IP by pointing hostname to the local listener.
      const response = await fetchPinnedPublic({
        href: `http://example.test:${address.port}/hello`,
        hostname: 'example.test',
        protocol: 'http:',
        port: String(address.port),
        pinnedAddress: '127.0.0.1',
        family: 4,
        pinnedAddresses: ['127.0.0.1'],
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('ok');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
