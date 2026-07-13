import React from 'react';
import type { RunContextUsageSummary } from '@shared/types/session';
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
  usage: RunContextUsageSummary | null;
  stale: boolean;
  onClose: () => void;
}> = ({ usage, stale, onClose }) => {
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

  if (!usage || usage.breakdown === null) {
    return renderEmpty(t('contextBreakdown.noData'));
  }

  const windowTokens = usage.contextWindowTokens ?? 0;
  const hasWindow = windowTokens > 0;
  const denom = hasWindow ? windowTokens : usage.occupiedTokens;
  const pct = (tokens: number): number => (denom > 0 ? (tokens / denom) * 100 : 0);
  const breakdown = usage.breakdown ?? [];

  // 明细恒显完整分类：后端未产出的段补 tokens=0，不隐藏空行。
  const orderedEntries = CONTEXT_BREAKDOWN_ORDER.map((id) => {
    const found = breakdown.find((entry) => entry.id === id);
    return found ?? { id, tokens: 0 };
  });

  const barEntries = orderedEntries.filter(
    (entry) => entry.tokens > 0 && entry.id !== 'free' && entry.id !== 'mcp_tools_deferred',
  );
  const legendEntries = orderedEntries;
  const hasRunTotals = usage.inputTokens > 0 || usage.outputTokens > 0;

  const runExtras = [
    usage.cacheReadTokens
      ? `${t('contextBreakdown.cacheReadLabel')} ${formatTokenCount(usage.cacheReadTokens)}`
      : null,
    usage.cacheWriteTokens
      ? `${t('contextBreakdown.cacheWriteLabel')} ${formatTokenCount(usage.cacheWriteTokens)}`
      : null,
    usage.reasoningTokens
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

        {hasWindow ? (
          <div className="context-breakdown-hero">
            <div className="context-breakdown-hero-row">
              <div className="context-breakdown-hero-usage">
                <span className="context-breakdown-pct-large">{usage.usagePercent}%</span>
                <span className="context-breakdown-summary-caption">{t('contextBreakdown.windowUsed')}</span>
              </div>
              <span className="context-breakdown-hero-tokens">
                ~{formatTokenCount(usage.occupiedTokens)} / {formatTokenCount(windowTokens)}{' '}
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
          </div>
        ) : null}

        {hasRunTotals ? (
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

        {detailsExpanded ? (
          <div id="context-breakdown-details" className="context-breakdown-details">
            <ContextBreakdownLegend entries={legendEntries} />
          </div>
        ) : null}

        {stale ? <p className="context-breakdown-footer">{t('contextBreakdown.staleNote')}</p> : null}
      </div>
    </>
  );
};
