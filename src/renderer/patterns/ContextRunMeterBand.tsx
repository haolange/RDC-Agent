import React from 'react';
import type { PreparedTurnContextSummary, RunContextUsageSummary } from '@shared/types/session';
import { useI18n } from '../i18n';
import { formatTokenCount } from '@shared/utils/tokens';

const METER_UNAVAILABLE = '—';

function hasCacheTelemetry(usage: RunContextUsageSummary): boolean {
  return typeof usage.cacheHitTokens === 'number' || typeof usage.cacheMissTokens === 'number';
}

function formatMeterTokens(value: number | undefined): string {
  return typeof value === 'number' ? formatTokenCount(value) : METER_UNAVAILABLE;
}

function formatMeterPercent(value: number | undefined): string {
  return typeof value === 'number' ? `${value}%` : METER_UNAVAILABLE;
}

export const MeterStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className={`context-breakdown-meter-stat${value === METER_UNAVAILABLE ? ' is-empty' : ''}`}>
    <span className="context-breakdown-meter-stat-label">{label}</span>
    <span className="context-breakdown-meter-stat-value">{value}</span>
  </div>
);

export const ContextRunMeterBand: React.FC<{
  usage: RunContextUsageSummary | null;
  prepared?: PreparedTurnContextSummary | null;
}> = ({ usage, prepared = null }) => {
  const { t } = useI18n();
  const isCurrent = prepared !== null;
  const metricUsage = isCurrent ? null : usage;
  const cacheReady = Boolean(metricUsage && hasCacheTelemetry(metricUsage));
  const saved = cacheReady ? (metricUsage?.cacheSavedTokens ?? metricUsage?.cacheHitTokens) : undefined;
  const hit = cacheReady ? metricUsage?.cacheHitTokens : undefined;
  const miss = cacheReady ? metricUsage?.cacheMissTokens : undefined;
  const reasoningValue = typeof metricUsage?.reasoningTokens === 'number' && metricUsage.reasoningTokens > 0
    ? formatTokenCount(metricUsage.reasoningTokens)
    : METER_UNAVAILABLE;
  const preparedTokens = prepared ? `~${formatTokenCount(prepared.preparedInputTokens)}` : METER_UNAVAILABLE;

  return (
    <div
      className="context-breakdown-run-meter"
      data-testid="context-breakdown-run-meter"
      data-columns="3"
      data-phase={isCurrent ? 'current' : 'actual'}
    >
      <div className="context-breakdown-run-columns">
        <section className="context-breakdown-run-col" data-col="tokens" aria-label={t('contextBreakdown.tokensColumn')}>
          <h3 className="context-breakdown-run-col-title">{t('contextBreakdown.tokensColumn')}</h3>
          <div className="context-breakdown-meter-stats">
            <MeterStat label={t('contextBreakdown.inputLabel')} value={isCurrent ? preparedTokens : formatMeterTokens(metricUsage?.inputTokens)} />
            <MeterStat label={t('contextBreakdown.outputLabel')} value={isCurrent ? METER_UNAVAILABLE : formatMeterTokens(metricUsage?.outputTokens)} />
            <MeterStat label={t('contextBreakdown.totalLabel')} value={isCurrent ? preparedTokens : formatMeterTokens(metricUsage?.totalTokens)} />
          </div>
        </section>
        <section className="context-breakdown-run-col" data-col="cache" aria-label={t('contextBreakdown.cacheColumn')}>
          <h3 className="context-breakdown-run-col-title">{t('contextBreakdown.cacheColumn')}</h3>
          <div className="context-breakdown-meter-stats">
            <MeterStat label={t('contextBreakdown.cacheSavedLabel')} value={formatMeterTokens(saved)} />
            <MeterStat label={t('contextBreakdown.cacheLatestLabel')} value={formatMeterPercent(metricUsage?.lastTurnCacheHitRate)} />
            <MeterStat label={t('contextBreakdown.cacheCumulativeLabel')} value={formatMeterPercent(metricUsage?.cumulativeCacheHitRate)} />
            <MeterStat
              label={t('contextBreakdown.cacheHitMissShort')}
              value={cacheReady ? `${formatMeterTokens(hit)} / ${formatMeterTokens(miss)}` : METER_UNAVAILABLE}
            />
          </div>
        </section>
        <section className="context-breakdown-run-col" data-col="reasoning" aria-label={t('contextBreakdown.reasoningLabel')}>
          <h3 className="context-breakdown-run-col-title">{t('contextBreakdown.reasoningLabel')}</h3>
          <div className="context-breakdown-meter-stats">
            <MeterStat label={t('contextBreakdown.totalLabel')} value={reasoningValue} />
          </div>
        </section>
      </div>
    </div>
  );
};
