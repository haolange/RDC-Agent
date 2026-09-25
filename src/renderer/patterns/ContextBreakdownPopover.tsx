import React from 'react';
import type { ContextUsageBreakdownId, PreparedTurnContextSummary, RunContextUsageSummary } from '@shared/types/session';
import { useI18n } from '../i18n';
import { useDynStyle } from '../lib/useDynStyle';
import { formatTokenCount } from '@shared/utils/tokens';
import { formatUsdCost } from '@shared/utils/cost';
import './ContextBreakdownPopover.css';
import './ContextBreakdownMeter.css';
import './ContextBreakdownLegend.css';
import { ContextBreakdownLegend } from './ContextBreakdownLegend';
import { ContextRunMeterBand, MeterStat } from './ContextRunMeterBand';
import {
  resolveDisplayedCompactionThreshold,
  resolveDisplayedContextWindow,
  resolveDisplayedGeneratable,
  resolveDisplayedPromptBudget,
  type ContextUsageSelectedProfile,
} from './contextUsageDisplay';
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
  selectedProfile: ContextUsageSelectedProfile | null;
  stale: boolean;
  estimated?: boolean;
  detailsExpanded: boolean;
  onDetailsExpandedChange: (expanded: boolean) => void;
  onClose: () => void;
}> = ({ prepared, phase, usage, selectedProfile, stale, estimated = false, detailsExpanded, onDetailsExpandedChange, onClose }) => {
  const { t } = useI18n();
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [availableHeight, setAvailableHeight] = React.useState<number | null>(null);
  const panelStyle = useDynStyle({ '--context-available-height': availableHeight == null ? undefined : `${availableHeight}px` });
  React.useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const measure = () => {
      const titlebarBottom = document.querySelector('.app-titlebar')?.getBoundingClientRect().bottom ?? 0;
      setAvailableHeight(Math.max(0, panel.getBoundingClientRect().bottom - titlebarBottom - 8));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (panel.parentElement) observer.observe(panel.parentElement);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, []);
  const showPrepared = phase === 'current' && prepared !== null;
  // A new request must not erase the last truthful snapshot before its own
  // prepared projection arrives. Preparing therefore keeps the same visual
  // structure and falls back to the previous actual usage when available.
  const showUsage = !showPrepared && usage !== null;
  const showEstimated = estimated && showUsage;
  const windowTokens = resolveDisplayedPromptBudget(showPrepared, prepared, usage, selectedProfile);
  const fullWindowTokens = resolveDisplayedContextWindow(showPrepared, prepared, usage, selectedProfile);
  const compactionThresholdTokens = resolveDisplayedCompactionThreshold(
    showPrepared, prepared, usage, selectedProfile,
  );
  const generatableTokens = resolveDisplayedGeneratable(showPrepared, prepared, usage, selectedProfile);
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
    : showEstimated
      ? t('contextBreakdown.projected')
      : showUsage
        ? phase === 'actual'
          ? t('contextBreakdown.actual')
          : t('contextBreakdown.lastActual')
        : t('contextBreakdown.noUsageYet');
  const thresholdRatio = typeof compactionThresholdTokens === 'number'
    && typeof windowTokens === 'number'
    && windowTokens > 0
    ? Math.max(0, Math.min(100, (compactionThresholdTokens / windowTokens) * 100))
    : null;
  const thresholdStyle = useDynStyle(
    thresholdRatio == null ? {} : { '--context-threshold-left': `${thresholdRatio}%` },
  );
  const budgetNoteParts: string[] = [];
  if (typeof compactionThresholdTokens === 'number') {
    budgetNoteParts.push(t('contextBreakdown.budgetNote.threshold', {
      threshold: formatTokenCount(compactionThresholdTokens),
    }));
  }
  if (
    typeof fullWindowTokens === 'number'
    && typeof windowTokens === 'number'
    && fullWindowTokens > windowTokens
  ) {
    budgetNoteParts.push(t('contextBreakdown.budgetNote.window', {
      window: formatTokenCount(fullWindowTokens),
    }));
  }
  if (typeof generatableTokens === 'number') {
    budgetNoteParts.push(t('contextBreakdown.budgetNote.generatable', {
      tokens: formatTokenCount(generatableTokens),
    }));
  }
  const formatKnownTokens = (value: number | null | undefined, projected = false): string => (
    typeof value === 'number' ? `${projected ? '~' : ''}${formatTokenCount(value)}` : METER_UNAVAILABLE
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
        ref={panelRef}
        {...panelStyle}
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
                {typeof displayUsagePercent === 'number'
                  ? `${showEstimated ? '~' : ''}${displayUsagePercent}%`
                  : METER_UNAVAILABLE}
              </span>
              <span className="context-breakdown-summary-caption">{summaryCaption}</span>
            </div>
            <span className="context-breakdown-hero-tokens">
              {formatKnownTokens(occupiedTokens, showPrepared || showEstimated)} / {formatKnownTokens(windowTokens)}{' '}
              {t('contextBreakdown.tokensLabel')}
            </span>
          </div>
          {budgetNoteParts.length > 0 ? (
            <p className="context-breakdown-window-note" data-testid="context-breakdown-window-note">
              {budgetNoteParts.join(' · ')}
            </p>
          ) : null}
          <div className="context-breakdown-bar" aria-hidden="true">
            {barEntries.map((entry) => (
              <ContextBarSegment
                key={entry.id}
                id={entry.id}
                widthPercent={pct(entry.tokens)}
                title={`${t(SEGMENT_LABEL_KEYS[entry.id])} · ${formatTokenCount(entry.tokens)}`}
              />
            ))}
            {thresholdRatio != null ? (
              <span
                className="context-breakdown-bar-threshold"
                data-testid="context-breakdown-bar-threshold"
                {...thresholdStyle}
              />
            ) : null}
          </div>
        </div>

        <ContextRunMeterBand usage={showUsage ? usage : null} prepared={showPrepared ? prepared : null} estimated={showEstimated} />

        {showUsage && usage && (usage.cost || typeof usage.cumulativeCost === 'number') ? (
          <div className="context-breakdown-cost-card" data-testid="context-breakdown-cost">
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
          onClick={() => onDetailsExpandedChange(!detailsExpanded)}
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

        {showEstimated ? (
          <p className="context-breakdown-footer" data-testid="context-breakdown-projected-note">
            {t('contextBreakdown.projectedNote')}
          </p>
        ) : stale ? (
          <p className="context-breakdown-footer">{t('contextBreakdown.staleNote')}</p>
        ) : null}
      </div>
    </>
  );
};
