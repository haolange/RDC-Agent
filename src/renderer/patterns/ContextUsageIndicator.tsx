import React, { useState } from 'react';
import type { RunContextUsageSummary } from '@shared/types/session';
import { ContextBreakdownPopover } from './ContextBreakdownPopover';

export const ContextUsageIndicator: React.FC<{
  usage: RunContextUsageSummary | null;
  stale?: boolean;
  language: string;
}> = ({ usage, stale = false, language }) => {
  const [open, setOpen] = useState(false);
  const usagePercent = usage?.usagePercent ?? 0;
  const normalizedPercent = Math.max(0, Math.min(100, usagePercent));
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - (normalizedPercent / 100));

  const windowLabel = usage?.hasConfiguredContextWindow && usage.contextWindowTokens
    ? `${normalizedPercent}% · ${formatCompact(usage.contextWindowTokens)}`
    : `${normalizedPercent}%`;
  const ariaLabel = language === 'zh-CN'
    ? `上下文窗口已用 ${normalizedPercent}%`
    : `Context window ${normalizedPercent}% used`;

  return (
    <div className="composer-usage">
      <button
        type="button"
        className={`composer-usage-indicator ${usage?.hasConfiguredContextWindow ? 'is-configured' : 'is-unconfigured'}${stale ? ' is-stale' : ''}`}
        data-testid="composer-usage-indicator"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={windowLabel}
        onClick={() => setOpen((value) => !value)}
      >
        <svg className="composer-usage-ring" width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
          <circle className="composer-usage-ring-track" cx="18" cy="18" r={radius} />
          <circle
            className="composer-usage-ring-progress"
            cx="18"
            cy="18"
            r={radius}
            style={{
              strokeDasharray: `${circumference} ${circumference}`,
              strokeDashoffset: dashOffset,
            }}
          />
        </svg>
        <span className="composer-usage-value">{normalizedPercent}%</span>
      </button>
      {open ? (
        <ContextBreakdownPopover usage={usage} stale={stale} language={language} onClose={() => setOpen(false)} />
      ) : null}
    </div>
  );
};

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return `${value}`;
}
