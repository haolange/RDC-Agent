import React from 'react';
import type { NextRequestContextProjection, RunContextUsageSummary } from '@shared/types/session';
import { useI18n } from '../i18n';
import { formatTokenCount } from '@shared/utils/tokens';
import { useAppSettingsStore } from '../stores/appSettingsStore';
import { ContextBreakdownLegend } from './ContextBreakdownLegend';
import {
  CONTEXT_BREAKDOWN_ORDER,
  SEGMENT_COLOR_VAR,
  SEGMENT_LABEL_KEYS,
} from './contextBreakdownMeta';

export const ContextBreakdownPopover: React.FC<{
  projection: NextRequestContextProjection | null;
  pending: boolean;
  usage: RunContextUsageSummary | null;
  stale: boolean;
  onClose: () => void;
}> = ({ projection, pending, usage, stale, onClose }) => {
  const { t } = useI18n();
  const detailsExpanded = useAppSettingsStore(
    (state) => state.settings.appearance.contextBreakdownExpanded,
  );
  const setContextBreakdownExpanded = useAppSettingsStore(
    (state) => state.setContextBreakdownExpanded,
  );

  const renderEmpty = (message: string) => (
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
        <p className="context-breakdown-empty">{message}</p>
      </div>
    </>
  );

  if (!projection && (!usage || usage.breakdown === null)) {
    return renderEmpty(t('contextBreakdown.noData'));
  }

  const estimated = projection?.status === 'ready' ? projection : null;
  const showActualAsPrimary = projection === null;
  const windowTokens = estimated?.promptBudgetTokens
    ?? (showActualAsPrimary ? usage?.contextWindowTokens ?? 0 : 0);
  const occupiedTokens = estimated?.estimatedInputTokens
    ?? (showActualAsPrimary ? usage?.occupiedTokens ?? 0 : 0);
  const displayUsagePercent = estimated?.usagePercent
    ?? (showActualAsPrimary ? usage?.usagePercent ?? 0 : 0);
  const hasWindow = windowTokens > 0;
  const denom = hasWindow ? windowTokens : occupiedTokens;
  const pct = (tokens: number): number => (denom > 0 ? (tokens / denom) * 100 : 0);
  const breakdown = estimated?.breakdown
    ?? (showActualAsPrimary ? usage?.breakdown ?? [] : []);

  // 明细恒显完整分类：后端未产出的段补 tokens=0，不隐藏空行。
  const orderedEntries = CONTEXT_BREAKDOWN_ORDER.map((id) => {
    const found = breakdown.find((entry) => entry.id === id);
    return found ?? { id, tokens: 0 };
  });

  const barEntries = orderedEntries.filter(
    (entry) => entry.tokens > 0 && entry.id !== 'free' && entry.id !== 'mcp_tools_deferred',
  );
  const legendEntries = orderedEntries;
  const hasRunTotals = Boolean(usage && (usage.inputTokens > 0 || usage.outputTokens > 0));

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

        {pending ? (
          <div className="context-breakdown-status is-pending" role="status">
            {t('contextBreakdown.updating')}
          </div>
        ) : null}

        {projection?.status === 'blocked' ? (
          <div className="context-breakdown-status is-blocked" role="alert">
            <strong>{t('contextBreakdown.blocked')}</strong>
            <span>{projection.blockingReason?.message}</span>
          </div>
        ) : null}

        {hasWindow ? (
          <div className="context-breakdown-hero">
            <div className="context-breakdown-hero-row">
              <div className="context-breakdown-hero-usage">
                <span className="context-breakdown-pct-large">{displayUsagePercent}%</span>
                <span className="context-breakdown-summary-caption">
                  {estimated ? t('contextBreakdown.estimatedNext') : t('contextBreakdown.windowUsed')}
                </span>
              </div>
              <span className="context-breakdown-hero-tokens">
                ~{formatTokenCount(occupiedTokens)} / {formatTokenCount(windowTokens)}{' '}
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
            {estimated ? (
              <div className="context-breakdown-projection-meta">
                <span>
                  {t('contextBreakdown.completeWindow')} {formatTokenCount(estimated.contextWindowTokens)}
                </span>
                <span>
                  {estimated.contextMode === 'one-million'
                    ? t('contextBreakdown.oneMillionMode')
                    : t('contextBreakdown.normalMode')}
                </span>
                {estimated.willCompact ? (
                  <span className="is-warning">{t('contextBreakdown.willCompact')}</span>
                ) : null}
                {estimated.filteredArtifactCount > 0 ? (
                  <span>{t('contextBreakdown.filteredArtifacts', { count: estimated.filteredArtifactCount })}</span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {hasRunTotals && showActualAsPrimary && usage ? (
          <div className="context-breakdown-run-totals">
            <span className="context-breakdown-run-label">{t('contextBreakdown.runTotals')}</span>
            <span className="context-breakdown-run-stat">
              {t('contextBreakdown.inputLabel')} {formatTokenCount(usage.inputTokens)}
              {' · '}
              {t('contextBreakdown.outputLabel')} {formatTokenCount(usage.outputTokens)}
              {' · '}
              {t('contextBreakdown.totalLabel')} {formatTokenCount(usage.totalTokens)}
              {runExtras.length > 0 ? (
                <>
                  {' · '}
                  {runExtras.join(' · ')}
                </>
              ) : null}
            </span>
          </div>
        ) : null}

        {usage && projection ? (
          <div className="context-breakdown-last-actual">
            <span className="context-breakdown-run-label">{t('contextBreakdown.lastActual')}</span>
            <span className="context-breakdown-run-stat">
              {usage.usagePercent}% · {t('contextBreakdown.inputLabel')} {formatTokenCount(usage.inputTokens)}
              {' · '}
              {t('contextBreakdown.outputLabel')} {formatTokenCount(usage.outputTokens)}
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
            aria-label={
              detailsExpanded
                ? t('contextBreakdown.detailsCollapseAria')
                : t('contextBreakdown.detailsExpandAria')
            }
            onClick={() => {
              void setContextBreakdownExpanded(!detailsExpanded);
            }}
          >
            <span
              className={`context-breakdown-details-chevron${detailsExpanded ? ' is-expanded' : ''}`}
              aria-hidden="true"
            >
              {/* 收起 ▶ / 展开 ▼：与侧栏树披露一致，箭头始终指向内容方向 */}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
            <span className="context-breakdown-details-label">{t('contextBreakdown.detailsLabel')}</span>
          </button>
        ) : null}

        {breakdown.length > 0 && detailsExpanded ? (
          <div id="context-breakdown-details" className="context-breakdown-details">
            <ContextBreakdownLegend entries={legendEntries} />
          </div>
        ) : null}

        {stale ? <p className="context-breakdown-footer">{t('contextBreakdown.staleNote')}</p> : null}
      </div>
    </>
  );
};
