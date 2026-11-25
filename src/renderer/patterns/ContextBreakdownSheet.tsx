import React from 'react';
import { formatTokenCount } from '@shared/utils/tokens';
import { useDynStyle } from '../lib/useDynStyle';
import { useI18n } from '../i18n';
import { Disclosure } from '../ui/Disclosure';
import { InlineError } from '../ui/InlineError';
import { ReadingSheet } from '../ui/ReadingSheet';
import { ContextBreakdownLegend } from './ContextBreakdownLegend';
import { ContextRunMeterBand, ContextUsageCost } from './ContextRunMeterBand';
import {
  awaitsExecutionContextWindow,
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
import type { ContextUsageBreakdownId, PreparedTurnContextSummary, RunContextUsageSummary } from '@shared/types/session';
import './ContextBreakdownSheet.css';
import './ContextBreakdownMeter.css';
import './ContextBreakdownLegend.css';

type PreparationPhase = 'idle' | 'preparing' | 'current' | 'actual';
const METER_UNAVAILABLE = '—';

const ContextBarSegment: React.FC<{
  id?: ContextUsageBreakdownId;
  widthPercent: number;
  title?: string;
}> = ({ id, widthPercent, title }) => {
  const dynStyle = useDynStyle({
    '--context-segment-width': `${widthPercent}%`,
  });

  return (
    <span
      className="context-breakdown-bar-segment"
      aria-hidden="true"
      data-segment={id}
      data-tooltip={title}
      {...dynStyle}
    />
  );
};

interface ContextBreakdownContentProps {
  prepared: PreparedTurnContextSummary | null;
  phase: PreparationPhase;
  usage: RunContextUsageSummary | null;
  selectedProfile: ContextUsageSelectedProfile | null;
  stale: boolean;
  estimated?: boolean;
  detailsExpanded: boolean;
  onDetailsExpandedChange: (expanded: boolean) => void;
}

/** Context usage in the shared reading sheet: same area, size and single scroller as the plan reader. */
export const ContextBreakdownSheet: React.FC<ContextBreakdownContentProps & {
  open: boolean;
  onClose: () => void;
  detailsSaveError?: string;
}> = ({ open, onClose, detailsSaveError, ...content }) => {
  const { t } = useI18n();
  return (
    <ReadingSheet open={open} title={t('contextBreakdown.title')} closeLabel={t('contextBreakdown.close')} onClose={onClose}
      className="context-breakdown" dataTestId="context-breakdown" animateHeight
      status={detailsSaveError === undefined ? undefined : (
        <InlineError detail={detailsSaveError}>{t('contextBreakdown.detailsSaveFailed')}</InlineError>
      )}>
      <ContextBreakdownContent {...content} />
    </ReadingSheet>
  );
};

export const ContextBreakdownContent: React.FC<ContextBreakdownContentProps> = ({
  prepared, phase, usage, selectedProfile, stale, estimated = false, detailsExpanded, onDetailsExpandedChange,
}) => {
  const { t } = useI18n();
  const showPrepared = phase === 'current' && prepared !== null;
  const awaitingWindow = showPrepared && awaitsExecutionContextWindow(prepared);
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
  const generatableTokens = awaitingWindow || (!showPrepared && !showUsage)
    ? null
    : resolveDisplayedGeneratable(showPrepared, prepared, usage, selectedProfile);
  const occupiedTokens = showPrepared
    ? prepared.preparedInputTokens
    : usage?.occupiedTokens;
  const displayUsagePercent = awaitingWindow || windowTokens === null
    ? null
    : showPrepared
    ? prepared.usagePercent
    : usage?.usagePercent;
  const breakdown = awaitingWindow
    ? []
    : showPrepared
    ? prepared.breakdown
    : usage?.breakdown ?? [];
  const hasAuthoritativeBreakdown = (showPrepared && !awaitingWindow) || Boolean(!showPrepared && usage && usage.breakdown !== null);
  const denom = windowTokens ?? 0;
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
  const summaryCaption = awaitingWindow
    ? t('contextBreakdown.windowPending')
    : showPrepared
    ? t('contextBreakdown.currentRequest')
    : showEstimated
      ? t('contextBreakdown.projected')
    : showUsage
        ? stale ? t('contextBreakdown.staleNote') : phase === 'actual'
          ? t('contextBreakdown.actual')
          : t('contextBreakdown.lastActual')
        : t('contextBreakdown.noUsageYet');
  const thresholdRatio = !awaitingWindow && typeof compactionThresholdTokens === 'number'
    && typeof windowTokens === 'number'
    && windowTokens > 0
    ? Math.max(0, Math.min(100, (compactionThresholdTokens / windowTokens) * 100))
    : null;
  const thresholdStyle = useDynStyle(
    thresholdRatio == null ? {} : { '--context-threshold-left': `${thresholdRatio}%` },
  );
  const showFullWindow = typeof fullWindowTokens === 'number'
    && typeof windowTokens === 'number'
    && fullWindowTokens > windowTokens;
  const formatKnownTokens = (value: number | null | undefined, projected = false): string => (
    typeof value === 'number' ? `${projected ? '~' : ''}${formatTokenCount(value)}` : METER_UNAVAILABLE
  );

  return (
    <div className="context-breakdown-content">
        <div className="context-breakdown-hero">
          <div className="context-breakdown-hero-usage" tabIndex={showEstimated || stale ? 0 : undefined}
            data-tooltip={showEstimated ? t('contextBreakdown.projectedNote') : stale ? t('contextBreakdown.staleNote') : undefined}>
            <span className="context-breakdown-pct-large">
              {typeof displayUsagePercent === 'number'
                ? t('contextBreakdown.used', { percent: `${showEstimated ? '~' : ''}${displayUsagePercent}%` })
                : METER_UNAVAILABLE}
            </span>
            <span className="context-breakdown-summary-caption">{summaryCaption}</span>
            <span className="context-breakdown-hero-tokens">
              {formatKnownTokens(occupiedTokens, showPrepared)}
              {!awaitingWindow ? ` / ${formatKnownTokens(windowTokens)}` : null}{' '}
              {t('contextBreakdown.tokensLabel')}
            </span>
          </div>
          <div className="context-breakdown-scale" {...thresholdStyle}>
            <div className="context-breakdown-bar" aria-hidden="true">
              {barEntries.map((entry) => (
                <ContextBarSegment
                  key={entry.id}
                  id={entry.id}
                  widthPercent={pct(entry.tokens)}
                  title={`${t(SEGMENT_LABEL_KEYS[entry.id])} · ${formatTokenCount(entry.tokens)}`}
                />
              ))}
              {barEntries.length === 0 && !awaitingWindow && typeof occupiedTokens === 'number' && occupiedTokens > 0 && denom > 0 ? (
                <ContextBarSegment widthPercent={Math.min(100, pct(occupiedTokens))} />
              ) : null}
              {thresholdRatio != null ? (
                <span
                  className="context-breakdown-bar-threshold"
                  data-testid="context-breakdown-bar-threshold"
                />
              ) : null}
            </div>
            {thresholdRatio !== null && compactionThresholdTokens !== null ? (
              <span className="context-breakdown-scale-label">
                {t('contextBreakdown.budgetNote.threshold', { threshold: formatTokenCount(compactionThresholdTokens) })}
              </span>
            ) : null}
          </div>
          {awaitingWindow && <p className="context-breakdown-window-note">{t('contextBreakdown.windowPendingNote')}</p>}
          {showFullWindow || typeof generatableTokens === 'number' ? (
            <dl className="context-breakdown-budget" data-testid="context-breakdown-window-note">
              {showFullWindow && <div><dt>{t('contextBreakdown.fullWindow')}</dt><dd>{formatTokenCount(fullWindowTokens)}</dd></div>}
              {typeof generatableTokens === 'number' && <div><dt>{t('contextBreakdown.turnOutput')}</dt><dd>~{formatTokenCount(generatableTokens)}</dd></div>}
            </dl>
          ) : null}
        </div>
        <Disclosure
          className="context-breakdown-disclosure"
          triggerClassName="context-breakdown-details-toggle"
          bodyClassName="context-breakdown-details"
          open={detailsExpanded}
          onOpenChange={onDetailsExpandedChange}
          triggerLabel={detailsExpanded ? t('contextBreakdown.detailsCollapseAria') : t('contextBreakdown.detailsExpandAria')}
          summary={t('contextBreakdown.detailsLabel')}
        >
          <ContextRunMeterBand usage={showUsage ? usage : null}
            preparedInput={showPrepared && !awaitingWindow ? prepared.preparedInputTokens : undefined}
            historical={stale || showEstimated} />
          <ContextUsageCost usage={showUsage ? usage : null} />
          <section>
            <h3 className="context-breakdown-section-title">
              {t(showEstimated ? 'contextBreakdown.estimatedBreakdown'
                : showPrepared || !showUsage ? 'contextBreakdown.currentBreakdown' : 'contextBreakdown.latestBreakdown')}
            </h3>
            <ContextBreakdownLegend entries={breakdown} unavailable={!hasAuthoritativeBreakdown} estimatedFreeSpace={showEstimated} />
          </section>
        </Disclosure>
    </div>
  );
};
