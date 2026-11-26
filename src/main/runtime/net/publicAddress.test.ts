import { lookup } from 'dns/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPublicAddress, pinPublicUrl } from './publicAddress';
import type { LookupAddress } from 'dns';

vi.mock('dns/promises', () => ({ lookup: vi.fn() }));

/** `vi.mocked(lookup)` binds the single-address overload; cast arrays for `{ all: true }`. */
function mockLookupAddresses(addresses: LookupAddress[]): void {
  vi.mocked(lookup).mockResolvedValueOnce(addresses as unknown as LookupAddress);
}

afterEach(() => vi.mocked(lookup).mockReset());

describe('public address table', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '100.127.255.254',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.0.8',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.19.255.255',
    '198.51.100.7',
    '203.0.113.9',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::127.0.0.1',
    '64:ff9b::a00:1',
    '64:ff9b::192.168.0.1',
    '2002:c0a8:101::1',
    '2002:7f00:1::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%eth0',
    'febf::1',
    'fec0::1',
    'ff02::1',
    '100::1',
    '2001:db8::1',
    '3fff::1',
    '[::1]',
    'not-an-ip',
    '',
  ])('treats %s as not public', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    '1.1.1.1',
    '8.8.8.8',
    '93.184.216.34',
    '100.63.255.255',
    '100.128.0.1',
    '172.15.255.255',
    '172.32.0.1',
    '198.17.255.255',
    '198.20.0.1',
    '223.255.255.255',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
    '2002:808:808::1',
    '[2606:4700::1]',
  ])('treats %s as public', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe('pinPublicUrl', () => {
  it('rejects invalid, non-http and, when asked, non-https URLs before any lookup', async () => {
    await expect(pinPublicUrl('not a url')).rejects.toThrow(/Invalid URL/);
    await expect(pinPublicUrl('ftp://example.com')).rejects.toThrow(/Blocked non-HTTP/);
    await expect(pinPublicUrl('http://example.com', { httpsOnly: true })).rejects.toThrow(/Blocked non-HTTPS/);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects local hosts and literal non-public addresses before any lookup', async () => {
    for (const url of [
      'http://localhost/x',
      'http://app.localhost/x',
      'http://localhost./x',
      'http://127.0.0.1/x',
      'http://2130706433/x',
      'http://0x7f.1/x',
      'http://[::1]/x',
      'http://[::ffff:10.0.0.1]/x',
      'http://100.64.0.1/x',
      'http://198.18.0.1/x',
    ]) {
      await expect(pinPublicUrl(url)).rejects.toThrow(/Blocked (local host|private network address)/);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects DNS failures, empty answers and any non-public resolution', async () => {
    vi.mocked(lookup).mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(pinPublicUrl('https://missing.example')).rejects.toThrow(/DNS lookup failed/);
    mockLookupAddresses([]);
    await expect(pinPublicUrl('https://empty.example')).rejects.toThrow(/no addresses/);
    mockLookupAddresses([
      { address: '1.2.3.4', family: 4 },
      { address: 'fd00::1', family: 6 },
    ]);
    await expect(pinPublicUrl('https://mixed.example')).rejects.toThrow(/Blocked private network address: fd00::1/);
  });

  it('pins every verified public address', async () => {
    mockLookupAddresses([
      { address: '2606:4700::1111', family: 6 },
      { address: '1.1.1.1', family: 4 },
    ]);
    await expect(pinPublicUrl('https://example.com:8443/path?q=1')).resolves.toMatchObject({
      hostname: 'example.com',
      protocol: 'https:',
      port: '8443',
      pinnedAddress: '2606:4700::1111',
      family: 6,
      pinnedAddresses: ['2606:4700::1111', '1.1.1.1'],
    });
  });
});
