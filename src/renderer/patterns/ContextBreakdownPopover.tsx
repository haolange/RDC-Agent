import React from 'react';
import type { PreparedTurnContextSummary, RunContextUsageSummary } from '@shared/types/session';
import { useI18n } from '../i18n';
import { formatTokenCount } from '@shared/utils/tokens';
import { useAppSettingsStore } from '../stores/appSettingsStore';
import { ContextBreakdownLegend } from './ContextBreakdownLegend';
import {
  CONTEXT_BREAKDOWN_ORDER,
  SEGMENT_COLOR_VAR,
  SEGMENT_LABEL_KEYS,
} from './contextBreakdownMeta';

type PreparationPhase = 'idle' | 'preparing' | 'current' | 'actual';

export const ContextBreakdownPopover: React.FC<{
  prepared: PreparedTurnContextSummary | null;
  phase: PreparationPhase;
  usage: RunContextUsageSummary | null;
  selectedContextWindowTokens: number | null;
  stale: boolean;
  onClose: () => void;
}> = ({ prepared, phase, usage, selectedContextWindowTokens, stale, onClose }) => {
  const { t } = useI18n();
  const detailsExpanded = useAppSettingsStore(
    (state) => state.settings.appearance.contextBreakdownExpanded,
  );
  const setContextBreakdownExpanded = useAppSettingsStore(
    (state) => state.setContextBreakdownExpanded,
  );
  const showPrepared = phase === 'current' && prepared !== null;
  const showActualAsPrimary = !showPrepared && usage !== null;
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
    (entry) => entry.tokens > 0 && entry.id !== 'free' && entry.id !== 'mcp_tools_deferred',
  );
  const hasRunTotals = Boolean(usage && (usage.inputTokens > 0 || usage.outputTokens > 0));
  const derivedContextLabel = prepared?.derivedContext.status === 'applied'
    ? t('contextBreakdown.derivedContextApplied')
    : prepared?.derivedContext.status === 'stale'
      ? t('contextBreakdown.derivedContextStale')
      : t('contextBreakdown.derivedContextNone');
  const runExtras = [
    usage?.cacheReadTokens
      ? `${t('contextBreakdown.cacheReadLabel')} ${formatTokenCount(usage.cacheReadTokens)}`
      : null,
    usage?.cacheWriteTokens
      ? `${t('contextBreakdown.cacheWriteLabel')} ${formatTokenCount(usage.cacheWriteTokens)}`
      : null,
    usage?.reasoningTokens
      ? `${t('contextBreakdown.reasoningLabel')} ${formatTokenCount(usage.reasoningTokens)}`
      : null,
  ].filter(Boolean);

  return (
    <>
      <div className="context-breakdown-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="context-breakdown" role="dialog" aria-label={t('contextBreakdown.title')} data-testid="context-breakdown">
        <div className="context-breakdown-header">
          <span className="context-breakdown-title">{t('contextBreakdown.title')}</span>
          <button type="button" className="context-breakdown-close" onClick={onClose} aria-label={t('contextBreakdown.close')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {phase === 'preparing' ? (
          <div className="context-breakdown-status is-pending" role="status">
            {t('contextBreakdown.preparing')}
          </div>
        ) : null}

        {!showPrepared && !showActualAsPrimary ? (
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
                <span
                  key={entry.id}
                  className="context-breakdown-bar-segment"
                  title={`${t(SEGMENT_LABEL_KEYS[entry.id])} · ${formatTokenCount(entry.tokens)}`}
                  style={{
                    width: `${pct(entry.tokens)}%`,
                    background: SEGMENT_COLOR_VAR[entry.id] ?? 'var(--token-context-deferred)',
                  }}
                />
              ))}
            </div>
            {showPrepared ? (
              <div className="context-breakdown-projection-meta">
                <span>
                  {t('contextBreakdown.completeWindow')} {formatTokenCount(prepared.contextWindowTokens)}
                </span>
                <span>
                  {prepared.contextMode === 'one-million'
                    ? t('contextBreakdown.oneMillionMode')
                    : t('contextBreakdown.normalMode')}
                </span>
                {prepared.compactionApplied ? (
                  <span className="is-warning">{t('contextBreakdown.compactionApplied')}</span>
                ) : null}
                {prepared.filteredArtifactCount > 0 ? (
                  <span>{t('contextBreakdown.filteredArtifacts', { count: prepared.filteredArtifactCount })}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        {hasRunTotals && showActualAsPrimary && usage ? (
          <div className="context-breakdown-run-totals">
            <span className="context-breakdown-run-label">{t('contextBreakdown.actual')}</span>
            <span className="context-breakdown-run-stat">
              {t('contextBreakdown.inputLabel')} {formatTokenCount(usage.inputTokens)}
              {' · '}{t('contextBreakdown.outputLabel')} {formatTokenCount(usage.outputTokens)}
              {' · '}{t('contextBreakdown.totalLabel')} {formatTokenCount(usage.totalTokens)}
              {runExtras.length > 0 ? ` · ${runExtras.join(' · ')}` : ''}
            </span>
          </div>
        ) : null}

        {usage && showPrepared ? (
          <div className="context-breakdown-last-actual">
            <span className="context-breakdown-run-label">{t('contextBreakdown.lastActual')}</span>
            <span className="context-breakdown-run-stat">
              {usage.usagePercent}% · {t('contextBreakdown.inputLabel')} {formatTokenCount(usage.inputTokens)}
              {' · '}{t('contextBreakdown.outputLabel')} {formatTokenCount(usage.outputTokens)}
              {usage.contextWindowTokens ? ` · ${formatTokenCount(usage.contextWindowTokens)}` : ''}
              {runExtras.length > 0 ? ` · ${runExtras.join(' · ')}` : ''}
            </span>
          </div>
        ) : null}

        {breakdown.length > 0 ? (
          <button
            type="button"
            className={`context-breakdown-details-toggle${detailsExpanded ? ' is-expanded' : ''}`}
            aria-expanded={detailsExpanded}
            aria-controls="context-breakdown-details"
            aria-label={detailsExpanded
              ? t('contextBreakdown.detailsCollapseAria')
              : t('contextBreakdown.detailsExpandAria')}
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
            {showPrepared ? (
              <div className="context-breakdown-runtime" data-testid="context-breakdown-runtime">
                <div className="context-breakdown-runtime-row">
                  <span className="context-breakdown-runtime-label">{t('contextBreakdown.continuationLabel')}</span>
                  <span className="context-breakdown-runtime-value">
                    <code>{prepared.continuation.strategy}</code>
                    <span>{t('contextBreakdown.replayedArtifacts', { count: prepared.continuation.replayedArtifactCount })}</span>
                    <span>{t('contextBreakdown.droppedArtifacts', { count: prepared.continuation.droppedArtifactCount })}</span>
                  </span>
                </div>
                {prepared.continuation.decisionCounts.length > 0 ? (
                  <div className="context-breakdown-runtime-row">
                    <span className="context-breakdown-runtime-label">{t('contextBreakdown.replayDecisionsLabel')}</span>
                    <span className="context-breakdown-runtime-value is-wrapping">
                      {prepared.continuation.decisionCounts.map((entry) => (
                        <code key={entry.reason}>{entry.reason} × {entry.count}</code>
                      ))}
                    </span>
                  </div>
                ) : null}
                <div className="context-breakdown-runtime-row">
                  <span className="context-breakdown-runtime-label">{t('contextBreakdown.derivedContextLabel')}</span>
                  <span className={'context-breakdown-runtime-value status-' + prepared.derivedContext.status}>
                    <span>{derivedContextLabel}</span>
                    {prepared.derivedContext.compactedTurnCount > 0 ? (
                      <span>{t('contextBreakdown.compactedTurns', { count: prepared.derivedContext.compactedTurnCount })}</span>
                    ) : null}
                  </span>
                </div>
                <div className="context-breakdown-runtime-row">
                  <span className="context-breakdown-runtime-label">{t('contextBreakdown.cachePolicyLabel')}</span>
                  <span className="context-breakdown-runtime-value is-wrapping">
                    <code>{prepared.cache.enabled ? prepared.cache.mode : t('contextBreakdown.cacheDisabled')}</code>
                    {prepared.cache.enabled ? <code>{prepared.cache.breakpoint} · {prepared.cache.ttl}</code> : null}
                    <span>{t('contextBreakdown.cacheStablePrefix', {
                      segments: prepared.cache.stableSegmentCount,
                      tokens: formatTokenCount(prepared.cache.stableTokenEstimate),
                    })}</span>
                    {prepared.cache.providerReported ? <span>{t('contextBreakdown.providerTelemetry')}</span> : null}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {stale ? <p className="context-breakdown-footer">{t('contextBreakdown.staleNote')}</p> : null}
      </div>
    </>
  );
};
