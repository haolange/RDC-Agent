import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchMock, lookupMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), lookupMock: vi.fn() }));
vi.mock('dns/promises', () => ({ lookup: lookupMock }));
vi.mock('../../net/assertPublicHttpUrl', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../net/assertPublicHttpUrl')>(),
  fetchPinnedPublic: fetchMock,
}));

import { webFetchTool } from './WebTools';
import { WEB_MAX_RESPONSE_BYTES } from './toolLimits';

const url = 'https://example.com/large-source';
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const output = (result: Awaited<ReturnType<typeof webFetchTool.execute>>) =>
  result.content[1].type === 'text' ? result.content[1].text : '';

describe('web_fetch complete-source pagination', () => {
  beforeEach(() => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    fetchMock.mockReset();
  });

  it('retrieves a clause beyond the old prefix and binds every page to the complete source', async () => {
    const body = `${'a'.repeat(WEB_MAX_RESPONSE_BYTES)}\nTAIL_CONTRACT_CLAUSE\n`;
    fetchMock.mockImplementation(() => Promise.resolve(new Response(body)));
    const first = await webFetchTool.execute('first', { url });
    expect(first.details).toMatchObject({
      bytes: Buffer.byteLength(body), sourceHash: digest(body), truncated: true,
      page: { offset: 0, bytes: WEB_MAX_RESPONSE_BYTES, nextOffset: WEB_MAX_RESPONSE_BYTES },
    });
    expect(output(first)).not.toContain('TAIL_CONTRACT_CLAUSE');
    const second = await webFetchTool.execute('second', {
      url, offset: first.details!.page.nextOffset!, expectedSourceHash: first.details!.sourceHash,
    });
    expect(output(second)).toContain('TAIL_CONTRACT_CLAUSE');
    expect(second.details).toMatchObject({ sourceHash: digest(body), truncated: false });
    expect(second.details!.page).not.toHaveProperty('nextOffset');
    expect(digest(output(first) + output(second))).toBe(digest(body));
  });

  it('refuses a changed source rather than joining pages from different responses', async () => {
    const body = 'a'.repeat(WEB_MAX_RESPONSE_BYTES + 1);
    fetchMock.mockResolvedValueOnce(new Response(body)).mockResolvedValueOnce(new Response(`${body}changed`));
    const first = await webFetchTool.execute('first', { url });
    await expect(webFetchTool.execute('changed', {
      url, offset: first.details!.page.nextOffset!, expectedSourceHash: first.details!.sourceHash,
    })).rejects.toThrow(/source hash mismatch/i);
  });

  it('does not split UTF-8 characters or normalize CRLF and BOM between pages', async () => {
    const body = `\ufeff${'x'.repeat(WEB_MAX_RESPONSE_BYTES - 4)}😀\r\n结尾`;
    fetchMock.mockImplementation(() => Promise.resolve(new Response(body)));
    const first = await webFetchTool.execute('first', { url });
    const second = await webFetchTool.execute('second', {
      url, offset: first.details!.page.nextOffset!, expectedSourceHash: first.details!.sourceHash,
    });
    expect(first.details!.page.bytes).toBeLessThanOrEqual(WEB_MAX_RESPONSE_BYTES);
    expect(second.details!.page.bytes).toBeLessThanOrEqual(WEB_MAX_RESPONSE_BYTES);
    expect(first.details!.sourceHash).toBe(digest(body));
    expect(output(first)).not.toContain('�');
    expect(output(second)).toContain('😀\r\n结尾');
    expect(digest(output(first) + output(second))).toBe(digest(body));
  });

  it.each([-1, 0.5, Number.NaN])('rejects an invalid cursor %s before network access', async (offset) => {
    await expect(webFetchTool.execute('bad', { url, offset, expectedSourceHash: 'a'.repeat(64) }))
      .rejects.toThrow(/offset/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a source hash for continuation and validates it before network access', async () => {
    await expect(webFetchTool.execute('missing', { url, offset: 1 })).rejects.toThrow(/source hash/i);
    await expect(webFetchTool.execute('bad-hash', { url, expectedSourceHash: 'invalid' })).rejects.toThrow(/source hash/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects cursors past the source or inside a surrogate pair', async () => {
    const body = 'a😀b';
    fetchMock.mockImplementation(() => Promise.resolve(new Response(body)));
    await expect(webFetchTool.execute('past', { url, offset: 99, expectedSourceHash: digest(body) }))
      .rejects.toThrow(/offset/i);
    await expect(webFetchTool.execute('split', { url, offset: 2, expectedSourceHash: digest(body) }))
      .rejects.toThrow(/offset/i);
  });

  it('rejects a source beyond its finite whole-source bound without returning a false complete prefix', async () => {
    fetchMock.mockResolvedValue(new Response('x'.repeat(2 * 1024 * 1024 + 1)));
    await expect(webFetchTool.execute('large', { url })).rejects.toThrow(/source.*limit|source.*bound/i);
  });

  it('rejects non-UTF-8 source bytes rather than hashing replacement text as the original', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([0xff, 0xfe, 0xff])));
    await expect(webFetchTool.execute('binary', { url })).rejects.toThrow(/UTF-8/i);
  });

  it('does not initiate a request after cancellation', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled before fetch'));
    await expect(webFetchTool.execute('cancelled', { url }, controller.signal))
      .rejects.toThrow('cancelled before fetch');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
