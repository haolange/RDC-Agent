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

const METER_UNAVAILABLE = '—';

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
  // A new request must not erase the last truthful snapshot before its own
  // prepared projection arrives. Preparing therefore keeps the same visual
  // structure and falls back to the previous actual usage when available.
  const showUsage = !showPrepared && usage !== null;
  const windowTokens = showPrepared
    ? prepared.promptBudgetTokens
    : usage?.contextWindowTokens ?? selectedContextWindowTokens;
  const occupiedTokens = showPrepared
    ? prepared.preparedInputTokens
    : usage?.occupiedTokens;
  const displayUsagePercent = showPrepared
    ? prepared.usagePercent
    : usage?.usagePercent;
  const breakdown = showPrepared
    ? prepared.breakdown
    : usage?.breakdown ?? [];
  const hasAuthoritativeBreakdown = showPrepared || Boolean(usage && usage.breakdown !== null);
  const denom = typeof windowTokens === 'number' && windowTokens > 0
    ? windowTokens
    : typeof occupiedTokens === 'number'
      ? occupiedTokens
      : 0;
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
  const summaryCaption = showPrepared
    ? t('contextBreakdown.currentRequest')
    : showUsage
      ? phase === 'actual'
        ? t('contextBreakdown.actual')
        : t('contextBreakdown.lastActual')
      : t('contextBreakdown.noUsageYet');
  const formatKnownTokens = (value: number | null | undefined): string => (
    typeof value === 'number' ? formatTokenCount(value) : METER_UNAVAILABLE
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

        <div className="context-breakdown-hero">
          <div className="context-breakdown-hero-row">
            <div className="context-breakdown-hero-usage">
              <span className="context-breakdown-pct-large">
                {typeof displayUsagePercent === 'number' ? `${displayUsagePercent}%` : METER_UNAVAILABLE}
              </span>
              <span className="context-breakdown-summary-caption">{summaryCaption}</span>
            </div>
            <span className="context-breakdown-hero-tokens">
              {showPrepared ? '~' : ''}{formatKnownTokens(occupiedTokens)} / {formatKnownTokens(windowTokens)}{' '}
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
        </div>

        <ContextRunMeterBand usage={showUsage ? usage : null} prepared={showPrepared ? prepared : null} />

        {showUsage && usage && (usage.cost || typeof usage.cumulativeCost === 'number') ? (
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

        {detailsExpanded ? (
          <div id="context-breakdown-details" className="context-breakdown-details">
            <ContextBreakdownLegend entries={breakdown} unavailable={!hasAuthoritativeBreakdown} />
          </div>
        ) : null}

        {stale ? <p className="context-breakdown-footer">{t('contextBreakdown.staleNote')}</p> : null}
      </div>
    </>
  );
};
