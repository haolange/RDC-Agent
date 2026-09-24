import React from 'react';
import type { PreparedTurnContextSummary, RunContextUsageSummary } from '@shared/types/session';
import { useI18n } from '../i18n';
import { buildContextRunMeterModel, type ContextMeterCardModel } from './contextRunMeterModel';

const METER_UNAVAILABLE = '—';

export const MeterStat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className={`context-breakdown-meter-stat${value === METER_UNAVAILABLE ? ' is-empty' : ''}`}>
    <span className="context-breakdown-meter-stat-label">{label}</span>
    <span className="context-breakdown-meter-stat-value">{value}</span>
  </div>
);

const ContextMeterCard: React.FC<{ card: ContextMeterCardModel }> = ({ card }) => {
  const { t } = useI18n();
  const title = card.id === 'tokens' ? t('contextBreakdown.tokensColumn')
    : card.id === 'cache' ? t('contextBreakdown.cacheColumn') : t('contextBreakdown.reasoningLabel');
  const labels = {
    input: t('contextBreakdown.inputLabel'), output: t('contextBreakdown.outputLabel'),
    latest: t('contextBreakdown.cacheLatestLabel'), cumulative: t('contextBreakdown.cacheCumulativeLabel'),
    hitMiss: t('contextBreakdown.cacheHitMissShort'),
    reasoningShare: t('contextBreakdown.reasoningShareLabel'),
  };
  return (
    <section className="context-breakdown-run-col" data-col={card.id} aria-label={title}>
      <h3 className="context-breakdown-run-col-title">{title}</h3>
      <div className={`context-breakdown-meter-primary${card.primaryValue === METER_UNAVAILABLE ? ' is-empty' : ''}`}>
        <strong className="context-breakdown-meter-primary-value">{card.primaryValue}</strong>
        <span className="context-breakdown-meter-primary-label">
          {card.primaryLabel === 'saved' ? t('contextBreakdown.cacheSavedLabel')
            : card.primaryLabel === 'reasoning' ? t('contextBreakdown.reasoningAmountLabel')
              : t('contextBreakdown.totalLabel')}
        </span>
      </div>
      {card.details.length > 0 ? (
        <dl className="context-breakdown-meter-details">
          {card.details.map(({ label, value }) => (
            <div className={`context-breakdown-meter-detail${value === METER_UNAVAILABLE ? ' is-empty' : ''}`} key={label}>
              <dt>{labels[label]}</dt><dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
};

export const ContextRunMeterBand: React.FC<{
  usage: RunContextUsageSummary | null;
  prepared?: PreparedTurnContextSummary | null;
}> = ({ usage, prepared = null }) => {
  return (
    <div
      className="context-breakdown-run-meter"
      data-testid="context-breakdown-run-meter"
      data-columns="3"
      data-phase={prepared ? 'current' : usage ? 'actual' : 'unavailable'}
    >
      <div className="context-breakdown-run-columns">
        {buildContextRunMeterModel(usage, prepared).map((card) => <ContextMeterCard key={card.id} card={card} />)}
      </div>
    </div>
  );
};
