import type { EffectiveModel, RequestPlan } from '@shared/types/providerCapability';
import { effectiveCatalogService } from './EffectiveCatalogService';
import { settingsService } from './SettingsService';

const DEFAULT_RETRY_SECONDS = 60;
const RESET_HEADERS = [
  'x-ratelimit-reset-requests',
  'x-ratelimit-reset-tokens',
  'x-ratelimit-reset',
  'ratelimit-reset',
  'x-ratelimit-reset-after',
];

function parseResetValue(value: string, nowMs: number, header: string): number | undefined {
  const duration = value.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/i);
  if (duration) {
    const amount = Number(duration[1]);
    const multiplier = duration[2].toLowerCase() === 'ms'
      ? 1
      : duration[2].toLowerCase() === 's'
        ? 1_000
        : duration[2].toLowerCase() === 'm'
          ? 60_000
          : 3_600_000;
    return nowMs + amount * multiplier;
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    if (header.endsWith('-after')) return nowMs + numeric * 1_000;
    if (numeric > 10_000_000_000) return numeric;
    if (numeric > 1_000_000_000) return numeric * 1_000;
    return nowMs + numeric * 1_000;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseQuotaFromHeaders(
  headers: Headers,
  now = new Date(),
): NonNullable<EffectiveModel['quota']> {
  const nowMs = now.getTime();
  const retryAfter = headers.get('retry-after')?.trim();
  let exhaustedUntilMs: number | undefined;
  let sourceHeader: string | undefined;
  if (retryAfter) {
    exhaustedUntilMs = parseResetValue(retryAfter, nowMs, 'retry-after');
    sourceHeader = 'Retry-After';
  }
  if (!exhaustedUntilMs) {
    for (const header of RESET_HEADERS) {
      const value = headers.get(header)?.trim();
      if (!value) continue;
      exhaustedUntilMs = parseResetValue(value, nowMs, header);
      sourceHeader = header;
      if (exhaustedUntilMs) break;
    }
  }
  exhaustedUntilMs ??= nowMs + DEFAULT_RETRY_SECONDS * 1_000;
  return {
    exhaustedUntil: new Date(Math.max(nowMs, exhaustedUntilMs)).toISOString(),
    note: sourceHeader
      ? `HTTP 429 quota reset derived from ${sourceHeader}`
      : `HTTP 429 quota reset header missing; retry deferred ${DEFAULT_RETRY_SECONDS}s`,
  };
}

export function recordQuotaFromResponse(plan: RequestPlan, response: Response): void {
  if (response.status !== 429) return;
  const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === plan.providerId);
  effectiveCatalogService.recordTransientQuota({
    providerId: plan.providerId,
    accountId: provider?.activeAccountId ?? `anonymous:${plan.providerId}`,
    protocol: plan.route.protocol,
  }, plan.effectiveModelId, parseQuotaFromHeaders(response.headers));
}
