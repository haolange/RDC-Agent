import { lookup } from 'dns/promises';
import * as net from 'net';
import type { AgentTool } from '../../agent/AgentTool';
import { truncateOutput } from './_shared';

interface WebFetchParams {
  url: string;
}

interface WebSearchParams {
  query: string;
}

interface WebResultDetails {
  url: string;
  status: number;
  bytes: number;
  truncated: boolean;
}

const MAX_RESPONSE_BYTES = 160 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const SEARCH_BASE_URL = process.env.RDC_AGENT_WEB_SEARCH_URL || 'https://s.jina.ai/';

export const webFetchTool: AgentTool<WebFetchParams, WebResultDetails> = {
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
    return fetchPublicText(params.url, signal);
  },
};

export const webSearchTool: AgentTool<WebSearchParams, WebResultDetails> = {
  name: 'web_search',
  label: 'Search Web',
  description: 'Search the public web using the configured read-only search endpoint and return text results with source links.',
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
    if (!params.query || !params.query.trim()) {
      throw new Error('query cannot be empty');
    }
    const base = SEARCH_BASE_URL.endsWith('/') ? SEARCH_BASE_URL : `${SEARCH_BASE_URL}/`;
    return fetchPublicText(`${base}${encodeURIComponent(params.query.trim())}`, signal);
  },
};

async function fetchPublicText(rawUrl: string, signal?: AbortSignal): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  details: WebResultDetails;
}> {
  const url = await assertPublicHttpUrl(rawUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = (): void => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/plain,text/markdown,text/html,application/json;q=0.9,*/*;q=0.5',
        'User-Agent': 'RDC-Agent/AskReadonlyWebTool',
      },
    });
    const finalUrl = await assertPublicHttpUrl(response.url);
    const arrayBuffer = await response.arrayBuffer();
    const bytes = arrayBuffer.byteLength;
    const limited = arrayBuffer.slice(0, MAX_RESPONSE_BYTES);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(limited);
    const truncated = bytes > MAX_RESPONSE_BYTES;
    const output = [
      `URL: ${finalUrl}`,
      `Status: ${response.status} ${response.statusText}`,
      truncated ? `[truncated at ${MAX_RESPONSE_BYTES} bytes]` : '',
      '',
      truncateOutput(text, MAX_RESPONSE_BYTES),
    ].filter(Boolean).join('\n');
    return {
      content: [{ type: 'text', text: output }],
      details: {
        url: finalUrl,
        status: response.status,
        bytes,
        truncated,
      },
    };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abort);
  }
}

async function assertPublicHttpUrl(rawUrl: string): Promise<string> {
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
  const addresses = await lookup(hostname, { all: true }).catch(() => []);
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
    const parts = value.split('.').map((part) => Number(part));
    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return true;
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (ipVersion === 6) {
    const normalized = value.toLowerCase();
    return (
      normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:')
    );
  }
  return false;
}
