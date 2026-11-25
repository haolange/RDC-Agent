import { describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({ requestPinned: vi.fn() }));
vi.mock('./pinnedTransport', () => transport);
vi.mock('dns/promises', () => ({
  lookup: vi.fn(async (host: string) => [{ address: host === 'internal.example' ? '10.0.0.7' : '93.184.216.34', family: 4 }]),
}));

import { fetchPublic, PublicRequestFailedError, PublicUrlDeniedError } from './publicEgress';

const options = { accept: '*/*', userAgent: 'test', maxResponseBytes: 1024, maxRedirects: 2, timeoutMs: 1000 };
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

describe('fetchPublic', () => {
  it('re-validates every redirect hop and never connects to a non-public target', async () => {
    transport.requestPinned.mockReset().mockResolvedValueOnce(redirect('https://internal.example/admin'));
    await expect(fetchPublic('https://example.com/', options)).rejects.toBeInstanceOf(PublicUrlDeniedError);
    expect(transport.requestPinned).toHaveBeenCalledTimes(1);
  });

  it('keeps https on every hop when asked', async () => {
    transport.requestPinned.mockReset().mockResolvedValueOnce(redirect('http://example.com/plain'));
    await expect(fetchPublic('https://example.com/', { ...options, httpsOnly: true })).rejects.toThrow(/Blocked non-HTTPS/);
  });

  it('follows public redirects and reports the final URL', async () => {
    transport.requestPinned.mockReset().mockResolvedValueOnce(redirect('/next')).mockResolvedValueOnce(new Response('ok'));
    const { response, finalUrl } = await fetchPublic('https://example.com/start', options);
    expect([await response.text(), finalUrl]).toEqual(['ok', 'https://example.com/next']);
  });

  it('reports redirect loops and transport failures with the hop that failed', async () => {
    transport.requestPinned.mockReset().mockResolvedValue(redirect('/again'));
    await expect(fetchPublic('https://example.com/', options)).rejects.toMatchObject({ url: 'https://example.com/again' });
    transport.requestPinned.mockReset().mockRejectedValueOnce(new Error('ECONNRESET'));
    const failure = fetchPublic('https://example.com/', options);
    await expect(failure).rejects.toBeInstanceOf(PublicRequestFailedError);
    await expect(failure).rejects.toThrow(/ECONNRESET/);
  });
});
