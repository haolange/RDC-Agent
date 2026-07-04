import React from 'react';
import type {
  ContextUsageBreakdownId,
  RunContextUsageSummary,
} from '@shared/types/session';
import { useI18n, type TranslationKey } from '../i18n';
import { formatTokenCount } from '../features/debugger/composer/turnControlsUtils';

const ORDER: ContextUsageBreakdownId[] = [
  'system_prompt',
  'rules',
  'memory_files',
  'system_tools',
  'mcp_tools',
  'subagent_definitions',
  'summarized_conversation',
  'conversation',
  'free',
];

const SEGMENT_COLOR_VAR: Record<ContextUsageBreakdownId, string> = {
  system_prompt:           'var(--token-text-placeholder)',
  rules:                   'var(--token-status-warning)',
  memory_files:            'var(--token-status-info)',
  system_tools:            'var(--token-status-success)',
  mcp_tools:               'var(--token-accent-primary)',
  subagent_definitions:    'var(--token-status-info)',
  summarized_conversation: 'var(--token-text-caption)',
  conversation:            'var(--token-text-link)',
  free:                    'var(--token-border-muted)',
};

const GROUPS: { id: string; labelKey: TranslationKey; ids: ContextUsageBreakdownId[] }[] = [
  { id: 'prompt', labelKey: 'contextBreakdown.groupPrompt', ids: ['system_prompt', 'rules', 'memory_files'] },
  { id: 'tools', labelKey: 'contextBreakdown.groupTools', ids: ['system_tools', 'mcp_tools', 'subagent_definitions'] },
  { id: 'conversation', labelKey: 'contextBreakdown.groupConversation', ids: ['summarized_conversation', 'conversation'] },
  { id: 'space', labelKey: 'contextBreakdown.groupSpace', ids: ['free'] },
];

const SEGMENT_LABEL_KEYS: Record<ContextUsageBreakdownId, TranslationKey> = {
  system_prompt: 'contextBreakdown.segment.system_prompt',
  rules: 'contextBreakdown.segment.rules',
  memory_files: 'contextBreakdown.segment.memory_files',
  system_tools: 'contextBreakdown.segment.system_tools',
  mcp_tools: 'contextBreakdown.segment.mcp_tools',
  subagent_definitions: 'contextBreakdown.segment.subagent_definitions',
  summarized_conversation: 'contextBreakdown.segment.summarized_conversation',
  conversation: 'contextBreakdown.segment.conversation',
  free: 'contextBreakdown.segment.free',
};

const COUNT_SUFFIX_KEYS: Partial<Record<ContextUsageBreakdownId, TranslationKey>> = {
  system_tools: 'contextBreakdown.countSuffix.system_tools',
  mcp_tools: 'contextBreakdown.countSuffix.mcp_tools',
  subagent_definitions: 'contextBreakdown.countSuffix.subagent_definitions',
  conversation: 'contextBreakdown.countSuffix.conversation',
};

const formatPct = (value: number): string => `${value.toFixed(1)}%`;

export const ContextBreakdownPopover: React.FC<{
  usage: RunContextUsageSummary | null;
  stale: boolean;
  onClose: () => void;
}> = ({ usage, stale, onClose }) => {
  const { t } = useI18n();

  const renderEmpty = (message: string) => (
    <>
      <div className="context-breakdown-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="context-breakdown" role="dialog" aria-label={t('contextBreakdown.title')} data-testid="context-breakdown">
        <div className="context-breakdown-header">
          <span className="context-breakdown-title">{t('contextBreakdown.title')}</span>
          <button type="button" className="context-breakdown-close" onClick={onClose} aria-label={t('contextBreakdown.close')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
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

  const orderedEntries = ORDER
    .map((id) => breakdown.find((entry) => entry.id === id))
    .filter(Boolean) as typeof breakdown;

  const barEntries = orderedEntries.filter((entry) => entry.tokens > 0 && entry.id !== 'free');
  const legendEntries = orderedEntries.filter((entry) => entry.tokens > 0 || entry.id === 'free');
  const hasRunTotals = usage.inputTokens > 0 || usage.outputTokens > 0;

  const renderLegendRow = (entry: (typeof breakdown)[number]) => {
    const suffixKey = COUNT_SUFFIX_KEYS[entry.id];
    const suffix = suffixKey ? t(suffixKey) : '';
    const countLabel =
      suffix && entry.count !== undefined && entry.count > 0
        ? `${entry.count}${suffix}`
        : null;

    return (
      <li key={entry.id} className={`context-breakdown-row${entry.id === 'free' ? ' is-free' : ''}`}>
        <span
          className="context-breakdown-swatch"
          style={{ background: SEGMENT_COLOR_VAR[entry.id] ?? 'var(--token-text-placeholder)' }}
          aria-hidden="true"
        />
        <span className="context-breakdown-label">{t(SEGMENT_LABEL_KEYS[entry.id])}</span>
        {countLabel ? <span className="context-breakdown-count">{countLabel}</span> : null}
        <span className="context-breakdown-tokens">{formatTokenCount(entry.tokens)}</span>
        <span className="context-breakdown-pct">
          {hasWindow && entry.id !== 'free' ? formatPct(pct(entry.tokens)) : '—'}
        </span>
      </li>
    );
  };

  return (
    <>
      <div className="context-breakdown-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="context-breakdown" role="dialog" aria-label={t('contextBreakdown.title')} data-testid="context-breakdown">
        <div className="context-breakdown-header">
          <span className="context-breakdown-title">{t('contextBreakdown.title')}</span>
          {hasWindow ? (
            <span className="context-breakdown-header-meta">
              {formatTokenCount(windowTokens)}
            </span>
          ) : null}
          <button type="button" className="context-breakdown-close" onClick={onClose} aria-label={t('contextBreakdown.close')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {hasWindow ? (
          <div className="context-breakdown-summary-row">
            <span className="context-breakdown-pct-large">{usage.usagePercent}%</span>
            <span className="context-breakdown-summary-caption">{t('contextBreakdown.windowUsed')}</span>
            <div className="context-breakdown-bar" aria-hidden="true">
              {barEntries.map((entry) => (
                <span
                  key={entry.id}
                  className="context-breakdown-bar-segment"
                  style={{
                    width: `${pct(entry.tokens)}%`,
                    background: SEGMENT_COLOR_VAR[entry.id] ?? 'var(--token-text-placeholder)',
                  }}
                />
              ))}
            </div>
          </div>
        ) : null}

        <ul className="context-breakdown-legend">
          {GROUPS.map((group) => {
            const groupEntries = group.ids
              .map((id) => legendEntries.find((entry) => entry.id === id))
              .filter(Boolean) as typeof legendEntries;
            if (groupEntries.length === 0) return null;
            return (
              <React.Fragment key={group.id}>
                <li className="context-breakdown-group-header">
                  {t(group.labelKey)}
                </li>
                {groupEntries.map(renderLegendRow)}
              </React.Fragment>
            );
          })}
        </ul>

        {hasRunTotals ? (
          <div className="context-breakdown-run-totals">
            <span className="context-breakdown-run-label">{t('contextBreakdown.runTotals')}</span>
            <span className="context-breakdown-run-stat">
              {t('contextBreakdown.inputLabel')} {formatTokenCount(usage.inputTokens)}
              {' · '}
              {t('contextBreakdown.outputLabel')} {formatTokenCount(usage.outputTokens)}
              {' · '}
              {t('contextBreakdown.totalLabel')} {formatTokenCount(usage.totalTokens)}
            </span>
          </div>
        ) : null}

        {stale ? <p className="context-breakdown-footer">{t('contextBreakdown.staleNote')}</p> : null}
      </div>
    </>
  );
};
