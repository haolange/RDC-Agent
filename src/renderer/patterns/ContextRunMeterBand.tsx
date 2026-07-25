import React from 'react';
import type { RunContextUsageSummary } from '@shared/types/session';
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

/** Flat Tokens | Cache | Reasoning strip under Actual / Last actual hero (phase lives in hero only). */
export const ContextRunMeterBand: React.FC<{
  usage: RunContextUsageSummary;
}> = ({ usage }) => {
  const { t } = useI18n();
  const cacheReady = hasCacheTelemetry(usage);
  const saved = cacheReady ? (usage.cacheSavedTokens ?? usage.cacheHitTokens) : undefined;
  const hit = cacheReady ? usage.cacheHitTokens : undefined;
  const miss = cacheReady ? usage.cacheMissTokens : undefined;
  const reasoningValue = typeof usage.reasoningTokens === 'number' && usage.reasoningTokens > 0
    ? formatTokenCount(usage.reasoningTokens)
    : METER_UNAVAILABLE;

  return (
    <div
      className="context-breakdown-run-meter"
      data-testid="context-breakdown-run-meter"
      data-columns="3"
    >
      <div className="context-breakdown-run-columns">
        <section className="context-breakdown-run-col" data-col="tokens" aria-label={t('contextBreakdown.tokensColumn')}>
          <h3 className="context-breakdown-run-col-title">{t('contextBreakdown.tokensColumn')}</h3>
          <div className="context-breakdown-meter-stats">
            <MeterStat label={t('contextBreakdown.inputLabel')} value={formatTokenCount(usage.inputTokens)} />
            <MeterStat label={t('contextBreakdown.outputLabel')} value={formatTokenCount(usage.outputTokens)} />
            <MeterStat label={t('contextBreakdown.totalLabel')} value={formatTokenCount(usage.totalTokens)} />
          </div>
        </section>
        <section className="context-breakdown-run-col" data-col="cache" aria-label={t('contextBreakdown.cacheColumn')}>
          <h3 className="context-breakdown-run-col-title">{t('contextBreakdown.cacheColumn')}</h3>
          <div className="context-breakdown-meter-stats">
            <MeterStat label={t('contextBreakdown.cacheSavedLabel')} value={formatMeterTokens(saved)} />
            <MeterStat
              label={t('contextBreakdown.cacheLatestLabel')}
              value={formatMeterPercent(usage.lastTurnCacheHitRate)}
            />
            <MeterStat
              label={t('contextBreakdown.cacheCumulativeLabel')}
              value={formatMeterPercent(usage.cumulativeCacheHitRate)}
            />
            <MeterStat
              label={t('contextBreakdown.cacheHitMissShort')}
              value={cacheReady
                ? `${formatMeterTokens(hit)} / ${formatMeterTokens(miss)}`
                : METER_UNAVAILABLE}
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
