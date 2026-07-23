import type { AgentTool } from '../../agent/AgentTool';
import { assertPublicHttpUrl } from '../../net/assertPublicHttpUrl';
import { truncateOutput } from './_shared';
import { WEB_MAX_REDIRECTS, WEB_MAX_RESPONSE_BYTES } from './toolLimits';

interface WebFetchParams {
  url: string;
}

interface WebSearchParams {
  query: string;
}

interface WebFetchDetails {
  kind: 'fetch';
  url: string;
  status: number;
  statusText: string;
  bytes: number;
  truncated: boolean;
  title?: string;
}

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: string;
  publishedAt?: string;
}

interface WebSearchDetails {
  kind: 'search';
  query: string;
  provider: string;
  url: string;
  status: number;
  statusText: string;
  bytes: number;
  truncated: boolean;
  resultCount: number;
  results: WebSearchResult[];
}

interface PublicTextResponse {
  finalUrl: string;
  status: number;
  statusText: string;
  bytes: number;
  truncated: boolean;
  text: string;
}

interface SearchProvider {
  name: string;
  buildUrl: (query: string) => string;
  parse: (html: string) => WebSearchResult[];
}

const MAX_RESPONSE_BYTES = WEB_MAX_RESPONSE_BYTES;
const REQUEST_TIMEOUT_MS = 12_000;
const SEARCH_RESULT_LIMIT = 6;

const SEARCH_PROVIDERS: SearchProvider[] = [
  {
    name: 'DuckDuckGo HTML',
    buildUrl: (query) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    parse: parseDuckDuckGoResults,
  },
  {
    name: 'Bing Web',
    buildUrl: (query) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
    parse: parseBingResults,
  },
];

export const webFetchTool: AgentTool<WebFetchParams, WebFetchDetails> = {
  name: 'web_fetch',
  label: 'Fetch Web Page',
  description: 'Fetch a public HTTP(S) URL as read-only text. Localhost, private networks, and oversized responses are blocked.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'Public http or https URL to fetch.',
      },
    },
    required: ['url'],
  },
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: 'network', category: 'web', requiresApproval: false },
  permissionHint: 'readonly',

  async execute(_toolCallId, params, signal) {
    const result = await fetchPublicText(params.url, signal);
    return {
      content: [{ type: 'text', text: result.contentText }],
      details: result.details,
    };
  },
};

export const webSearchTool: AgentTool<WebSearchParams, WebSearchDetails> = {
  name: 'web_search',
  label: 'Search Web',
  description: 'Search the public web with a zero-configuration read-only provider and return discovery results. Use web_fetch on selected source pages before factual summaries, especially latest/current/today requests.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query. Do not include secrets or private file contents.',
      },
    },
    required: ['query'],
  },
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: 'network', category: 'web', requiresApproval: false },
  permissionHint: 'readonly',

  async execute(_toolCallId, params, signal) {
    const query = params.query?.trim();
    if (!query) {
      throw new Error('Search query cannot be empty.');
    }
    return searchPublicWeb(query, signal);
  },
};

function extractHtmlTitle(text: string): string | undefined {
  const match = text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) return undefined;
  const title = cleanHtmlText(match[1]).replace(/\s+/g, ' ').trim();
  return title ? title.slice(0, 160) : undefined;
}

async function fetchPublicText(rawUrl: string, signal?: AbortSignal): Promise<{
  contentText: string;
  details: WebFetchDetails;
}> {
  const response = await requestPublicText(rawUrl, signal, 'text/plain,text/markdown,text/html,application/json;q=0.9,*/*;q=0.5');
  const title = extractHtmlTitle(response.text);
  return {
    contentText: [
      `URL: ${response.finalUrl}`,
      title ? `Title: ${title}` : '',
      `Status: ${response.status} ${response.statusText}`,
      response.truncated ? `[truncated at ${MAX_RESPONSE_BYTES} bytes]` : '',
      '',
      truncateOutput(response.text, MAX_RESPONSE_BYTES),
    ].filter(Boolean).join('\n'),
    details: {
      kind: 'fetch',
      url: response.finalUrl,
      status: response.status,
      statusText: response.statusText,
      bytes: response.bytes,
      truncated: response.truncated,
      ...(title ? { title } : {}),
    },
  };
}

async function searchPublicWeb(query: string, signal?: AbortSignal): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  details: WebSearchDetails;
}> {
  const failures: string[] = [];

  for (const provider of SEARCH_PROVIDERS) {
    const searchUrl = provider.buildUrl(query);
    try {
      const response = await requestPublicText(searchUrl, signal, 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5');
      const results = provider.parse(response.text).slice(0, SEARCH_RESULT_LIMIT);
      if (results.length === 0) {
        failures.push(`${provider.name}: no parseable results`);
        continue;
      }

      const output = [
        `Search query: ${query}`,
        `Provider: ${provider.name}`,
        `Results: ${results.length}`,
        '',
        ...results.flatMap((result, index) => {
          const meta = [
            result.source ? `Source: ${result.source}` : '',
            result.publishedAt ? `Date: ${result.publishedAt}` : '',
          ].filter(Boolean).join(' | ');
          return [
            `${index + 1}. ${result.title}`,
            `   ${result.url}`,
            meta ? `   ${meta}` : '',
            result.snippet ? `   ${result.snippet}` : '',
          ].filter(Boolean);
        }),
      ].join('\n');

      return {
        content: [{ type: 'text', text: output }],
        details: {
          kind: 'search',
          query,
          provider: provider.name,
          url: response.finalUrl,
          status: response.status,
          statusText: response.statusText,
          bytes: response.bytes,
          truncated: response.truncated,
          resultCount: results.length,
          results,
        },
      };
    } catch (error) {
      failures.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Web search failed for "${query}". ${failures.join(' | ')}`);
}

async function requestPublicText(rawUrl: string, signal?: AbortSignal, accept = '*/*'): Promise<PublicTextResponse> {
  let currentUrl = await assertPublicHttpUrl(rawUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error(`Timed out after ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS);
  const abort = (): void => controller.abort(signal?.reason ?? new Error('Request aborted'));
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for (let hop = 0; hop <= WEB_MAX_REDIRECTS; hop += 1) {
      const response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: accept,
          'User-Agent': 'RDC-Agent/AskReadonlyWebTool',
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error(`Redirect missing Location header from ${currentUrl}`);
        }
        const next = new URL(location, currentUrl).toString();
        currentUrl = await assertPublicHttpUrl(next);
        continue;
      }
      const { bytes, text, truncated } = await readResponseBodyLimited(response, MAX_RESPONSE_BYTES);
      return {
        finalUrl: currentUrl,
        status: response.status,
        statusText: response.statusText,
        bytes,
        truncated,
        text,
      };
    }
    throw new Error(`Too many redirects (>${WEB_MAX_REDIRECTS}) starting from ${rawUrl}`);
  } catch (error) {
    throw createNetworkError(currentUrl, error);
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abort);
  }
}

async function readResponseBodyLimited(
  response: Response,
  maxBytes: number,
): Promise<{ bytes: number; text: string; truncated: boolean }> {
  if (!response.body) {
    return { bytes: 0, text: '', truncated: false };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (total >= maxBytes) {
      truncated = true;
      break;
    }
    const remaining = maxBytes - total;
    if (value.byteLength > remaining) {
      chunks.push(value.subarray(0, remaining));
      total += remaining;
      truncated = true;
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  try {
    await reader.cancel();
  } catch {
    /* ignore */
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    bytes: total,
    truncated,
    text: new TextDecoder('utf-8', { fatal: false }).decode(merged),
  };
}

function createNetworkError(url: string, error: unknown): Error {
  const host = safeHost(url);
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const cause = record.cause && typeof record.cause === 'object' ? record.cause as Record<string, unknown> : {};
  const causeCode = typeof cause.code === 'string' ? cause.code : '';
  const causeMessage = typeof cause.message === 'string' ? cause.message : '';
  const errorName = typeof record.name === 'string' ? record.name : '';
  const errorMessage = typeof record.message === 'string' ? record.message : String(error);
  const isAbort = errorName === 'AbortError' || /abort|timed out/i.test(`${causeMessage} ${errorMessage}`);
  const reason = isAbort
    ? `request timed out after ${REQUEST_TIMEOUT_MS}ms or was aborted`
    : [causeCode, causeMessage || errorMessage].filter(Boolean).join(' - ');
  const next = new Error(`Network request failed for ${host}: ${reason || 'unknown network error'}`);
  (next as Error & { cause?: unknown }).cause = error;
  return next;
}

function safeHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname || rawUrl;
  } catch {
    return rawUrl;
  }
}

export function parseDuckDuckGoResults(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const anchorPattern = /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) && results.length < SEARCH_RESULT_LIMIT) {
    const url = decodeDuckDuckGoUrl(decodeHtml(match[1]));
    const title = cleanHtmlText(match[2]);
    if (!url || !title) continue;
    const nearby = html.slice(match.index + match[0].length, match.index + match[0].length + 1600);
    const snippet = cleanHtmlText(
      nearby.match(/<a\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1]
      ?? nearby.match(/<div\b[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1]
      ?? '',
    );
    const source = getSourceDomain(url);
    const publishedAt = extractPublishedDate(`${title} ${snippet} ${cleanHtmlText(nearby)}`);
    results.push({ title, url, snippet, source, ...(publishedAt ? { publishedAt } : {}) });
  }
  return dedupeResults(results);
}

export function parseBingResults(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const blockPattern = /<li\b[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(html)) && results.length < SEARCH_RESULT_LIMIT) {
    const block = match[1];
    const anchor = block.match(/<h2[^>]*>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i);
    if (!anchor) continue;
    const url = decodeHtml(anchor[1]);
    const title = cleanHtmlText(anchor[2]);
    const snippet = cleanHtmlText(block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '');
    const source = getSourceDomain(url);
    const publishedAt = extractPublishedDate(cleanHtmlText(block));
    if (url && title) results.push({ title, url, snippet, source, ...(publishedAt ? { publishedAt } : {}) });
  }
  return dedupeResults(results);
}

const MONTHS: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

function getSourceDomain(rawUrl: string): string | undefined {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return hostname.replace(/^www\./, '') || undefined;
  } catch {
    return undefined;
  }
}

export function extractPublishedDate(text: string): string | undefined {
  const source = text.replace(/\s+/g, ' ');
  const iso = source.match(/\b((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/);
  if (iso) return formatDateParts(iso[1], iso[2], iso[3]);

  const monthDayYear = source.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(0?[1-9]|[12]\d|3[01]),?\s+((?:19|20)\d{2})\b/i);
  if (monthDayYear) {
    const month = MONTHS[monthDayYear[1].replace('.', '').toLowerCase()];
    if (month) return formatDateParts(monthDayYear[3], month, monthDayYear[2]);
  }

  const dayMonthYear = source.match(/\b(0?[1-9]|[12]\d|3[01])\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+((?:19|20)\d{2})\b/i);
  if (dayMonthYear) {
    const month = MONTHS[dayMonthYear[2].replace('.', '').toLowerCase()];
    if (month) return formatDateParts(dayMonthYear[3], month, dayMonthYear[1]);
  }

  return undefined;
}

function formatDateParts(year: string, month: string, day: string): string | undefined {
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  if (!Number.isInteger(numericYear) || !Number.isInteger(numericMonth) || !Number.isInteger(numericDay)) return undefined;
  if (numericMonth < 1 || numericMonth > 12 || numericDay < 1 || numericDay > 31) return undefined;
  return `${String(numericYear).padStart(4, '0')}-${String(numericMonth).padStart(2, '0')}-${String(numericDay).padStart(2, '0')}`;
}
function decodeDuckDuckGoUrl(rawUrl: string): string {
  const withProtocol = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
  try {
    const parsed = new URL(withProtocol);
    const uddg = parsed.searchParams.get('uddg');
    return uddg ? decodeURIComponent(uddg) : parsed.toString();
  } catch {
    return rawUrl;
  }
}

function dedupeResults(results: WebSearchResult[]): WebSearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = result.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanHtmlText(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match;
    }
    if (lower.startsWith('#')) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _match;
    }
    return named[lower] ?? _match;
  });
}
