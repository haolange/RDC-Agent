import React, { useState } from 'react';
import type { NextRequestContextProjection, RunContextUsageSummary } from '@shared/types/session';
import { ContextBreakdownPopover } from './ContextBreakdownPopover';
import { formatTokenCount } from '@shared/utils/tokens';
import { useI18n } from '../i18n';

export const ContextUsageIndicator: React.FC<{
  usage: RunContextUsageSummary | null;
  projection: NextRequestContextProjection | null;
  pending?: boolean;
  stale?: boolean;
}> = ({ usage, projection, pending = false, stale = false }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const hasProjection = projection !== null;
  const usagePercent = projection?.status === 'ready'
    ? projection.usagePercent
    : usage?.usagePercent ?? 0;
  const normalizedPercent = Math.max(0, Math.min(100, usagePercent));
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - (normalizedPercent / 100));

  const windowLabel = projection?.status === 'ready'
    ? `${pending ? `${t('contextBreakdown.updatingShort')} · ` : ''}${t('contextBreakdown.estimatedNext')} ${formatTokenCount(projection.estimatedInputTokens)} / ${formatTokenCount(projection.promptBudgetTokens)} · ${t('contextBreakdown.completeWindow')} ${formatTokenCount(projection.contextWindowTokens)}`
    : projection?.status === 'blocked'
      ? projection.blockingReason?.message ?? t('contextBreakdown.blocked')
      : usage?.contextWindowTokens
        ? `${t('contextBreakdown.lastActual')} ${normalizedPercent}% · ${formatTokenCount(usage.contextWindowTokens)}`
        : t('contextBreakdown.estimatingNext');
  const ariaLabel = projection?.status === 'blocked'
    ? t('contextBreakdown.blockedAria')
    : t('contextBreakdown.estimatedAria', { percent: normalizedPercent });

  return (
    <div className="composer-usage">
      <button
        type="button"
        className={`composer-usage-indicator${stale && !hasProjection ? ' is-stale' : ''}${pending ? ' is-pending' : ''}${projection?.status === 'blocked' ? ' is-blocked' : ''}`}
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
        <span className="composer-usage-value">
          <span className="composer-usage-value-label">
            {hasProjection ? t('contextBreakdown.estimatedBadge') : t('contextBreakdown.lastBadge')}
          </span>
          <span className="composer-usage-value-number">
            {projection?.status === 'blocked' ? '!' : `${normalizedPercent}%`}
          </span>
        </span>
      </button>
      {open ? (
        <ContextBreakdownPopover
          projection={projection}
          pending={pending}
          usage={usage}
          stale={stale}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
};
