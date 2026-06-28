import React from 'react';
import type {
  ContextUsageBreakdownId,
  RunContextUsageSummary,
} from '@shared/types/session';

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

const GROUPS: { id: string; labelZh: string; labelEn: string; ids: ContextUsageBreakdownId[] }[] = [
  { id: 'prompt',       labelZh: '提示词', labelEn: 'Prompt',       ids: ['system_prompt', 'rules', 'memory_files'] },
  { id: 'tools',        labelZh: '工具',   labelEn: 'Tools',        ids: ['system_tools', 'mcp_tools', 'subagent_definitions'] },
  { id: 'conversation', labelZh: '对话',   labelEn: 'Conversation', ids: ['summarized_conversation', 'conversation'] },
  { id: 'space',        labelZh: '空间',   labelEn: 'Space',        ids: ['free'] },
];

interface Copy {
  title: string;
  windowUsed: string;
  runTotals: string;
  inputLabel: string;
  outputLabel: string;
  totalLabel: string;
  close: string;
  noData: string;
  noWindow: string;
  noWindowShort: string;
  staleNote: string;
  labels: Record<ContextUsageBreakdownId, string>;
  countSuffix: Partial<Record<ContextUsageBreakdownId, string>>;
}

const buildCopy = (language: string): Copy => {
  if (language === 'zh-CN') {
    return {
      title: '上下文窗口',
      windowUsed: '已用',
      runTotals: '本次运行',
      inputLabel: '输入',
      outputLabel: '输出',
      totalLabel: '共',
      close: '关闭',
      noData: '暂无上下文用量数据，开始一次 Debug / Analyze 运行后将自动更新。',
      noWindow: '未配置窗口上限，无法计算占用率。前往 Settings › Providers 配置 contextWindowTokens。',
      noWindowShort: '未配置窗口',
      staleNote: '来自上次运行',
      labels: {
        system_prompt:           '系统提示',
        rules:                   '规则',
        memory_files:            '记忆文件',
        system_tools:            '系统工具',
        mcp_tools:               'MCP 工具',
        subagent_definitions:    '子 Agent',
        summarized_conversation: '压缩摘要',
        conversation:            '对话消息',
        free:                    '空闲',
      },
      countSuffix: {
        system_tools:         '个',
        mcp_tools:            '个',
        subagent_definitions: '个',
        conversation:         '条',
      },
    };
  }
  return {
    title: 'Context window',
    windowUsed: 'used',
    runTotals: 'This run',
    inputLabel: 'In',
    outputLabel: 'Out',
    totalLabel: 'Total',
    close: 'Close',
    noData: 'No context usage yet. It updates automatically once a Debug / Analyze run starts.',
    noWindow: 'No context window configured for this model. Set contextWindowTokens in Settings › Providers.',
    noWindowShort: 'No limit',
    staleNote: 'From the last run',
    labels: {
      system_prompt:           'System prompt',
      rules:                   'Rules',
      memory_files:            'Memory files',
      system_tools:            'System tools',
      mcp_tools:               'MCP tools',
      subagent_definitions:    'Subagents',
      summarized_conversation: 'Summarized',
      conversation:            'Conversation',
      free:                    'Free space',
    },
    countSuffix: {
      system_tools:         '',
      mcp_tools:            '',
      subagent_definitions: '',
      conversation:         ' msgs',
    },
  };
};

const formatCompact = (value: number): string => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${value}`;
};

const formatPct = (value: number): string => `${value.toFixed(1)}%`;

const WarningIcon: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

export const ContextBreakdownPopover: React.FC<{
  usage: RunContextUsageSummary | null;
  stale: boolean;
  language: string;
  onClose: () => void;
}> = ({ usage, stale, language, onClose }) => {
  const copy = buildCopy(language);

  const renderEmpty = (message: string) => (
    <>
      <div className="context-breakdown-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="context-breakdown" role="dialog" aria-label={copy.title} data-testid="context-breakdown">
        <div className="context-breakdown-header">
          <span className="context-breakdown-title">{copy.title}</span>
          <button type="button" className="context-breakdown-close" onClick={onClose} aria-label={copy.close}>
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
    return renderEmpty(copy.noData);
  }

  const hasWindow = usage.hasConfiguredContextWindow && (usage.contextWindowTokens ?? 0) > 0;
  const windowTokens = usage.contextWindowTokens ?? 0;
  const denom = hasWindow ? windowTokens : usage.occupiedTokens;
  const pct = (tokens: number): number => (denom > 0 ? (tokens / denom) * 100 : 0);

  const breakdown = usage.breakdown ?? [];

  const orderedEntries = ORDER
    .map((id) => breakdown.find((e) => e.id === id))
    .filter(Boolean) as typeof breakdown;

  const barEntries = orderedEntries.filter((e) => e.tokens > 0 && e.id !== 'free');
  const legendEntries = hasWindow
    ? orderedEntries.filter((e) => e.tokens > 0 || e.id === 'free')
    : orderedEntries.filter((e) => e.tokens > 0);

  const hasRunTotals = usage.inputTokens > 0 || usage.outputTokens > 0;

  const renderLegendRow = (entry: (typeof breakdown)[number]) => {
    const suffix = copy.countSuffix[entry.id];
    const countLabel =
      suffix !== undefined && entry.count !== undefined && entry.count > 0
        ? `${entry.count}${suffix}`
        : null;
    return (
      <li key={entry.id} className={`context-breakdown-row${entry.id === 'free' ? ' is-free' : ''}`}>
        <span
          className="context-breakdown-swatch"
          style={{ background: SEGMENT_COLOR_VAR[entry.id] ?? 'var(--token-text-placeholder)' }}
          aria-hidden="true"
        />
        <span className="context-breakdown-label">{copy.labels[entry.id] ?? entry.id}</span>
        {countLabel ? <span className="context-breakdown-count">{countLabel}</span> : null}
        <span className="context-breakdown-tokens">{formatCompact(entry.tokens)}</span>
        <span className="context-breakdown-pct">
          {hasWindow && entry.id !== 'free' ? formatPct(pct(entry.tokens)) : '—'}
        </span>
      </li>
    );
  };

  return (
    <>
      <div className="context-breakdown-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="context-breakdown" role="dialog" aria-label={copy.title} data-testid="context-breakdown">

        <div className="context-breakdown-header">
          <span className="context-breakdown-title">{copy.title}</span>
          {hasWindow ? (
            <span className="context-breakdown-header-meta">
              {formatCompact(usage.occupiedTokens)} / {formatCompact(windowTokens)}
            </span>
          ) : (
            <span className="context-breakdown-no-window-hint" title={copy.noWindow}>
              <WarningIcon />
              {copy.noWindowShort}
            </span>
          )}
          <button type="button" className="context-breakdown-close" onClick={onClose} aria-label={copy.close}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {hasWindow ? (
          <div className="context-breakdown-summary-row">
            <span className="context-breakdown-pct-large">{usage.usagePercent}%</span>
            <span className="context-breakdown-summary-caption">{copy.windowUsed}</span>
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
              .map((id) => legendEntries.find((e) => e.id === id))
              .filter(Boolean) as typeof legendEntries;
            if (groupEntries.length === 0) return null;
            return (
              <React.Fragment key={group.id}>
                <li className="context-breakdown-group-header">
                  {language === 'zh-CN' ? group.labelZh : group.labelEn}
                </li>
                {groupEntries.map(renderLegendRow)}
              </React.Fragment>
            );
          })}
        </ul>

        {hasRunTotals ? (
          <div className="context-breakdown-run-totals">
            <span className="context-breakdown-run-label">{copy.runTotals}</span>
            <span className="context-breakdown-run-stat">
              {copy.inputLabel} {formatCompact(usage.inputTokens)}
              {' · '}
              {copy.outputLabel} {formatCompact(usage.outputTokens)}
              {' · '}
              {copy.totalLabel} {formatCompact(usage.totalTokens)}
            </span>
          </div>
        ) : null}

        {stale ? <p className="context-breakdown-footer">{copy.staleNote}</p> : null}
      </div>
    </>
  );
};
