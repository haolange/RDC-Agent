import { describe, expect, it } from 'vitest';
import { parseQuotaFromHeaders } from './ProviderQuota';

const NOW = new Date('2026-07-13T00:00:00.000Z');

describe('provider quota parsing', () => {
  it('prefers Retry-After seconds', () => {
    const headers = new Headers({ 'Retry-After': '120', 'x-ratelimit-reset': '30' });
    expect(parseQuotaFromHeaders(headers, NOW)).toEqual({
      exhaustedUntil: '2026-07-13T00:02:00.000Z',
      note: 'HTTP 429 quota reset derived from Retry-After',
    });
  });

  it('parses epoch reset headers', () => {
    const headers = new Headers({ 'x-ratelimit-reset-requests': '1783900920' });
    expect(parseQuotaFromHeaders(headers, NOW).exhaustedUntil).toBe('2026-07-13T00:02:00.000Z');
  });

  it('parses vendor duration reset headers', () => {
    const headers = new Headers({ 'x-ratelimit-reset-tokens': '1500ms' });
    expect(parseQuotaFromHeaders(headers, NOW)).toEqual({
      exhaustedUntil: '2026-07-13T00:00:01.500Z',
      note: 'HTTP 429 quota reset derived from x-ratelimit-reset-tokens',
    });
  });

  it('uses a short transient fallback without capability changes', () => {
    expect(parseQuotaFromHeaders(new Headers(), NOW)).toEqual({
      exhaustedUntil: '2026-07-13T00:01:00.000Z',
      note: 'HTTP 429 quota reset header missing; retry deferred 60s',
    });
  });
});
