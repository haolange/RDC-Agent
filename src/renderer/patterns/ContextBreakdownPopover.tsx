import React from 'react';
import type { ContextUsageBreakdownId, PreparedTurnContextSummary, RunContextUsageSummary } from '@shared/types/session';
import { useI18n } from '../i18n';
import { useDynStyle } from '../lib/useDynStyle';
import { formatTokenCount } from '@shared/utils/tokens';
import { formatUsdCost } from '@shared/utils/cost';
import { useAppSettingsStore } from '../stores/appSettingsStore';
import { ContextBreakdownLegend } from './ContextBreakdownLegend';
import { ContextRunMeterBand, MeterStat } from './ContextRunMeterBand';
import {
  CONTEXT_BREAKDOWN_ORDER,
  SEGMENT_LABEL_KEYS,
} from './contextBreakdownMeta';

type PreparationPhase = 'idle' | 'preparing' | 'current' | 'actual';

const ContextBarSegment: React.FC<{
  id: ContextUsageBreakdownId;
  widthPercent: number;
  title: string;
}> = ({ id, widthPercent, title }) => {
  const dynStyle = useDynStyle({
    '--context-segment-width': `${widthPercent}%`,
  });

  return (
    <span
      className="context-breakdown-bar-segment"
      data-segment={id}
      title={title}
      {...dynStyle}
    />
  );
};

export const ContextBreakdownPopover: React.FC<{
  prepared: PreparedTurnContextSummary | null;
  phase: PreparationPhase;
  usage: RunContextUsageSummary | null;
  selectedContextWindowTokens: number | null;
  stale: boolean;
  onClose: () => void;
}> = ({ prepared, phase, usage, selectedContextWindowTokens, stale, onClose }) => {
  const { t } = useI18n();
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const detailsExpanded = useAppSettingsStore(
    (state) => state.settings.appearance.contextBreakdownExpanded,
  );
  const setContextBreakdownExpanded = useAppSettingsStore(
    (state) => state.setContextBreakdownExpanded,
  );
  const showPrepared = phase === 'current' && prepared !== null;
  const showActualAsPrimary = (phase === 'actual' || phase === 'idle') && usage !== null;
  const windowTokens = showPrepared
    ? prepared.promptBudgetTokens
    : showActualAsPrimary
      ? usage.contextWindowTokens ?? selectedContextWindowTokens ?? 0
      : selectedContextWindowTokens ?? 0;
  const occupiedTokens = showPrepared
    ? prepared.preparedInputTokens
    : showActualAsPrimary
      ? usage.occupiedTokens
      : 0;
  const displayUsagePercent = showPrepared
    ? prepared.usagePercent
    : showActualAsPrimary
      ? usage.usagePercent
      : 0;
  const breakdown = showPrepared
    ? prepared.breakdown
    : showActualAsPrimary
      ? usage.breakdown ?? []
      : [];
  const denom = windowTokens > 0 ? windowTokens : occupiedTokens;
  const pct = (tokens: number): number => (denom > 0 ? (tokens / denom) * 100 : 0);
  const orderedEntries = CONTEXT_BREAKDOWN_ORDER.map((id) => (
    breakdown.find((entry) => entry.id === id) ?? { id, tokens: 0 }
  ));
  const barEntries = orderedEntries.filter(
    (entry) => entry.tokens > 0
      && entry.id !== 'free'
      && entry.id !== 'mcp_tools_deferred'
      && entry.id !== 'builtin_tools_deferred',
  );

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    closeButtonRef.current?.focus();
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <>
      <div className="context-breakdown-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="context-breakdown"
        role="dialog"
        aria-modal="true"
        aria-label={t('contextBreakdown.title')}
        data-testid="context-breakdown"
      >
        <div className="context-breakdown-header">
          <span className="context-breakdown-title">{t('contextBreakdown.title')}</span>
          <button
            ref={closeButtonRef}
            type="button"
            className="context-breakdown-close"
            onClick={onClose}
            aria-label={t('contextBreakdown.close')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {phase === 'preparing' ? (
          <div className="context-breakdown-preparing" data-testid="context-breakdown-preparing">
            <div className="context-breakdown-status is-pending" role="status">
              {t('contextBreakdown.preparing')}
            </div>
            {selectedContextWindowTokens ? (
              <span className="context-breakdown-run-stat">
                {t('contextBreakdown.selectedWindow')} {formatTokenCount(selectedContextWindowTokens)}
              </span>
            ) : null}
          </div>
        ) : !showPrepared && !showActualAsPrimary ? (
          <div className="context-breakdown-empty-state">
            <p className="context-breakdown-empty">{t('contextBreakdown.noUsageYet')}</p>
            {selectedContextWindowTokens ? (
              <span className="context-breakdown-run-stat">
                {t('contextBreakdown.selectedWindow')} {formatTokenCount(selectedContextWindowTokens)}
              </span>
            ) : null}
          </div>
        ) : (
          <div className="context-breakdown-hero">
            <div className="context-breakdown-hero-row">
              <div className="context-breakdown-hero-usage">
                <span className="context-breakdown-pct-large">{displayUsagePercent}%</span>
                <span className="context-breakdown-summary-caption">
                  {showPrepared
                    ? t('contextBreakdown.currentRequest')
                    : phase === 'actual'
                      ? t('contextBreakdown.actual')
                      : t('contextBreakdown.lastActual')}
                </span>
              </div>
              <span className="context-breakdown-hero-tokens">
                {showPrepared ? '~' : ''}{formatTokenCount(occupiedTokens)} / {formatTokenCount(windowTokens)}{' '}
                {t('contextBreakdown.tokensLabel')}
              </span>
            </div>
            <div className="context-breakdown-bar" aria-hidden="true">
              {barEntries.map((entry) => (
                <ContextBarSegment
                  key={entry.id}
                  id={entry.id}
                  widthPercent={pct(entry.tokens)}
                  title={`${t(SEGMENT_LABEL_KEYS[entry.id])} · ${formatTokenCount(entry.tokens)}`}
                />
              ))}
            </div>
            {showPrepared ? (
              <div className="context-breakdown-projection-meta">
                <span>{t('contextBreakdown.completeWindow')} {formatTokenCount(prepared.contextWindowTokens)}</span>
                <span>{prepared.contextMode === 'one-million' ? t('contextBreakdown.oneMillionMode') : t('contextBreakdown.normalMode')}</span>
                {prepared.compactionApplied ? <span className="is-warning">{t('contextBreakdown.compactionApplied')}</span> : null}
                {prepared.filteredArtifactCount > 0 ? (
                  <span>{t('contextBreakdown.filteredArtifacts', { count: prepared.filteredArtifactCount })}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        {showPrepared || showActualAsPrimary ? (
          <ContextRunMeterBand usage={usage} prepared={showPrepared ? prepared : null} />
        ) : null}

        {showActualAsPrimary && usage && (usage.cost || typeof usage.cumulativeCost === 'number') ? (
          <div className="context-breakdown-run-meter" data-testid="context-breakdown-cost">
            <h3 className="context-breakdown-run-col-title">{t('contextBreakdown.costColumn')}</h3>
            <div className="context-breakdown-meter-stats">
              {usage.cost ? <MeterStat label={t('contextBreakdown.costThisTurn')} value={formatUsdCost(usage.cost.total)} /> : null}
              {typeof usage.cumulativeCost === 'number' ? (
                <MeterStat label={t('contextBreakdown.costThisRun')} value={formatUsdCost(usage.cumulativeCost)} />
              ) : null}
              {usage.cost ? (
                <>
                  <MeterStat label={t('contextBreakdown.costInput')} value={formatUsdCost(usage.cost.input)} />
                  <MeterStat label={t('contextBreakdown.costOutput')} value={formatUsdCost(usage.cost.output)} />
                  {typeof usage.cost.cacheRead === 'number' && usage.cost.cacheRead > 0 ? (
                    <MeterStat label={t('contextBreakdown.costCacheRead')} value={formatUsdCost(usage.cost.cacheRead)} />
                  ) : null}
                  {typeof usage.cost.cacheWrite === 'number' && usage.cost.cacheWrite > 0 ? (
                    <MeterStat label={t('contextBreakdown.costCacheWrite')} value={formatUsdCost(usage.cost.cacheWrite)} />
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {breakdown.length > 0 ? (
          <button
            type="button"
            className={`context-breakdown-details-toggle${detailsExpanded ? ' is-expanded' : ''}`}
            aria-expanded={detailsExpanded}
            aria-controls="context-breakdown-details"
            aria-label={detailsExpanded ? t('contextBreakdown.detailsCollapseAria') : t('contextBreakdown.detailsExpandAria')}
            onClick={() => { void setContextBreakdownExpanded(!detailsExpanded); }}
          >
            <span className={`context-breakdown-details-chevron${detailsExpanded ? ' is-expanded' : ''}`} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
            <span className="context-breakdown-details-label">{t('contextBreakdown.detailsLabel')}</span>
          </button>
        ) : null}

        {breakdown.length > 0 && detailsExpanded ? (
          <div id="context-breakdown-details" className="context-breakdown-details">
            <ContextBreakdownLegend entries={orderedEntries} />
          </div>
        ) : null}

        {stale ? <p className="context-breakdown-footer">{t('contextBreakdown.staleNote')}</p> : null}
      </div>
    </>
  );
};
