import type { PreparedTurnContextSummary, RunContextUsageSummary } from '@shared/types/session';
import { formatTokenCount } from '@shared/utils/tokens';

const unavailable = '—';
const tokens = (value: number | undefined): string => typeof value === 'number' ? formatTokenCount(value) : unavailable;
const percent = (value: number | undefined): string => typeof value === 'number' ? `${value}%` : unavailable;

export interface ContextMeterCardModel {
  id: 'tokens' | 'cache' | 'reasoning';
  primaryLabel: 'total' | 'saved' | 'reasoning';
  primaryValue: string;
  details: Array<{ label: 'input' | 'output' | 'latest' | 'cumulative' | 'hitMiss' | 'reasoningShare'; value: string }>;
}

export function buildContextRunMeterModel(
  usage: RunContextUsageSummary | null,
  prepared: PreparedTurnContextSummary | null,
): ContextMeterCardModel[] {
  const current = prepared !== null;
  const actual = current ? null : usage;
  const preparedValue = prepared ? `~${formatTokenCount(prepared.preparedInputTokens)}` : unavailable;
  const hasCache = actual != null && (typeof actual.cacheHitTokens === 'number' || typeof actual.cacheMissTokens === 'number');
  const saved = actual?.cacheSavedTokens ?? actual?.cacheHitTokens;
  const reasoningShare = typeof actual?.reasoningTokens === 'number'
    && typeof actual.outputTokens === 'number'
    && actual.outputTokens > 0
    && actual.reasoningTokens <= actual.outputTokens
    ? `${Math.round(actual.reasoningTokens / actual.outputTokens * 100)}%` : unavailable;
  return [
    {
      id: 'tokens', primaryLabel: 'total',
      primaryValue: current ? preparedValue : tokens(actual?.totalTokens),
      details: [
        { label: 'input', value: current ? preparedValue : tokens(actual?.inputTokens) },
        { label: 'output', value: current ? unavailable : tokens(actual?.outputTokens) },
      ],
    },
    {
      id: 'cache', primaryLabel: 'saved', primaryValue: tokens(saved),
      details: [
        { label: 'latest', value: percent(actual?.lastTurnCacheHitRate) },
        { label: 'cumulative', value: percent(actual?.cumulativeCacheHitRate) },
        { label: 'hitMiss', value: hasCache ? `${tokens(actual?.cacheHitTokens)} / ${tokens(actual?.cacheMissTokens)}` : unavailable },
      ],
    },
    { id: 'reasoning', primaryLabel: 'reasoning', primaryValue: tokens(actual?.reasoningTokens),
      details: [{ label: 'reasoningShare', value: reasoningShare }] },
  ];
}
