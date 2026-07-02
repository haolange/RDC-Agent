import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { lookupMock } = vi.hoisted(() => ({
  lookupMock: vi.fn(),
}));

vi.mock('dns/promises', () => ({
  lookup: lookupMock,
}));

import { webFetchTool, webSearchTool, parseBingResults, parseDuckDuckGoResults, extractPublishedDate } from './WebTools';

function responseWithUrl(body: string, url: string, init?: ResponseInit): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, 'url', { value: url, configurable: true });
  return response;
}

describe('WebTools', () => {
  beforeEach(() => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('fetches public HTTP text and returns structured details', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(responseWithUrl('Example Domain', 'https://example.com/', { status: 200, statusText: 'OK' }));

    const result = await webFetchTool.execute('fetch-1', { url: 'https://example.com' });

    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect(result.content[0].type === 'text' ? result.content[0].text : '').toContain('Status: 200 OK');
    expect(result.details).toMatchObject({
      kind: 'fetch',
      url: 'https://example.com/',
      status: 200,
      statusText: 'OK',
      truncated: false,
    });
  });

  it('blocks localhost and private network targets before fetch', async () => {
    await expect(webFetchTool.execute('fetch-local', { url: 'http://localhost:3000' }))
      .rejects.toThrow('Blocked local host');

    lookupMock.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
    await expect(webFetchTool.execute('fetch-private', { url: 'https://example.internal' }))
      .rejects.toThrow('Blocked private network address');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports network failures with host and low-level cause', async () => {
    const fetchMock = vi.mocked(fetch);
    const cause = Object.assign(new Error('Client network socket disconnected'), { code: 'ECONNRESET' });
    fetchMock.mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause }));

    await expect(webFetchTool.execute('fetch-reset', { url: 'https://example.com' }))
      .rejects.toThrow('Network request failed for example.com: ECONNRESET');
  });

  it('parses DuckDuckGo HTML results', () => {
    const results = parseDuckDuckGoResults(`
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Frenderdoc.org%2F&amp;rut=abc">RenderDoc</a>
      <a class="result__snippet">Jun 30, 2026 - A stand-alone graphics debugger.</a>
    `);

    expect(results).toEqual([
      {
        title: 'RenderDoc',
        url: 'https://renderdoc.org/',
        snippet: 'Jun 30, 2026 - A stand-alone graphics debugger.',
        source: 'renderdoc.org',
        publishedAt: '2026-06-30',
      },
    ]);
  });

  it('parses Bing HTML results', () => {
    const results = parseBingResults(`
      <li class="b_algo"><h2><a href="https://renderdoc.org/">RenderDoc</a></h2><span class="news_dt">Jun 30, 2026</span><div><p>Graphics debugger.</p></div></li>
    `);

    expect(results).toEqual([
      {
        title: 'RenderDoc',
        url: 'https://renderdoc.org/',
        snippet: 'Graphics debugger.',
        source: 'renderdoc.org',
        publishedAt: '2026-06-30',
      },
    ]);
  });

  it('does not invent dates when result text has no date', () => {
    const [result] = parseDuckDuckGoResults(`
      <a rel="nofollow" class="result__a" href="https://example.com/news">Example News</a>
      <a class="result__snippet">A source without a visible publication date.</a>
    `);

    expect(result).toMatchObject({
      title: 'Example News',
      url: 'https://example.com/news',
      source: 'example.com',
      snippet: 'A source without a visible publication date.',
    });
    expect(result).not.toHaveProperty('publishedAt');
    expect(extractPublishedDate('Published recently')).toBeUndefined();
  });

  it('searches with the zero-config provider and returns result details', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(responseWithUrl(`
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Frenderdoc.org%2F&amp;rut=abc">RenderDoc</a>
      <a class="result__snippet">Jun 30, 2026 - A stand-alone graphics debugger.</a>
    `, 'https://html.duckduckgo.com/html/?q=RenderDoc', { status: 200, statusText: 'OK' }));

    const result = await webSearchTool.execute('search-1', { query: 'RenderDoc' });
    const text = result.content[0].type === 'text' ? result.content[0].text : '';

    expect(text).toContain('Provider: DuckDuckGo HTML');
    expect(text).toContain('https://renderdoc.org/');
    expect(text).toContain('Source: renderdoc.org | Date: 2026-06-30');
    expect(result.details).toMatchObject({
      kind: 'search',
      query: 'RenderDoc',
      provider: 'DuckDuckGo HTML',
      resultCount: 1,
      results: [{ title: 'RenderDoc', url: 'https://renderdoc.org/', source: 'renderdoc.org', publishedAt: '2026-06-30' }],
    });
  });

  it('falls back to Bing when the first provider has no parseable results', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(responseWithUrl('<html>No results</html>', 'https://html.duckduckgo.com/html/?q=RenderDoc', { status: 200, statusText: 'OK' }))
      .mockResolvedValueOnce(responseWithUrl('<li class="b_algo"><h2><a href="https://renderdoc.org/">RenderDoc</a></h2><p>Graphics debugger.</p></li>', 'https://www.bing.com/search?q=RenderDoc', { status: 200, statusText: 'OK' }));

    const result = await webSearchTool.execute('search-2', { query: 'RenderDoc' });

    expect(result.details).toMatchObject({ provider: 'Bing Web', resultCount: 1 });
  });
});
