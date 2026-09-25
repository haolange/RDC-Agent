import type { PreparedTurnContextSummary, RunContextUsageSummary } from '@shared/types/session';
import { formatTokenCount } from '@shared/utils/tokens';

const unavailable = '—';
const tokens = (value: number | undefined): string => typeof value === 'number' ? formatTokenCount(value) : unavailable;
const percent = (value: number | undefined): string => typeof value === 'number' ? `${value}%` : unavailable;
const estimatedValue = (value: string, estimated: boolean): string => estimated && value !== unavailable ? `~${value}` : value;

export interface ContextMeterCardModel {
  id: 'tokens' | 'cache' | 'reasoning';
  primaryLabel: 'total' | 'saved' | 'reasoning';
  primaryValue: string;
  details: Array<{ label: 'input' | 'output' | 'latest' | 'cumulative' | 'hitMiss' | 'reasoningShare'; value: string }>;
}

export function buildContextRunMeterModel(
  usage: RunContextUsageSummary | null,
  prepared: PreparedTurnContextSummary | null,
  estimated = false,
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
      primaryValue: current ? preparedValue : estimatedValue(tokens(actual?.totalTokens), estimated),
      details: [
        { label: 'input', value: current ? preparedValue : estimatedValue(tokens(actual?.inputTokens), estimated) },
        { label: 'output', value: current ? unavailable : estimatedValue(tokens(actual?.outputTokens), estimated) },
      ],
    },
    {
      id: 'cache', primaryLabel: 'saved', primaryValue: estimatedValue(tokens(saved), estimated),
      details: [
        { label: 'latest', value: estimatedValue(percent(actual?.lastTurnCacheHitRate), estimated) },
        { label: 'cumulative', value: estimatedValue(percent(actual?.cumulativeCacheHitRate), estimated) },
        { label: 'hitMiss', value: hasCache ? `${estimatedValue(tokens(actual?.cacheHitTokens), estimated)} / ${estimatedValue(tokens(actual?.cacheMissTokens), estimated)}` : unavailable },
      ],
    },
    { id: 'reasoning', primaryLabel: 'reasoning', primaryValue: estimatedValue(tokens(actual?.reasoningTokens), estimated),
      details: [{ label: 'reasoningShare', value: estimatedValue(reasoningShare, estimated) }] },
  ];
}
