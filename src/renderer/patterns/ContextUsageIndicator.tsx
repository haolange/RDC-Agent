import React, { useCallback, useRef, useState } from 'react';
import type { PreparedTurnContextSummary, RunContextUsageSummary } from '@shared/types/session';
import { ContextBreakdownPopover } from './ContextBreakdownPopover';
import { formatTokenCount } from '@shared/utils/tokens';
import { formatUsdCost } from '@shared/utils/cost';
import { useI18n } from '../i18n';

type PreparationPhase = 'idle' | 'preparing' | 'current' | 'actual';

const METER_UNAVAILABLE = '—';

export const ContextUsageIndicator: React.FC<{
  usage: RunContextUsageSummary | null;
  prepared: PreparedTurnContextSummary | null;
  phase: PreparationPhase;
  selectedContextWindowTokens: number | null;
  stale?: boolean;
}> = ({ usage, prepared, phase, selectedContextWindowTokens, stale = false }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const showPrepared = phase === 'current' && prepared !== null;
  const usagePercent = showPrepared ? prepared.usagePercent : usage?.usagePercent ?? 0;
  const normalizedPercent = Math.max(0, Math.min(100, usagePercent));
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - (normalizedPercent / 100));
  const windowTokens = showPrepared
    ? prepared.contextWindowTokens
    : usage?.contextWindowTokens ?? selectedContextWindowTokens;

  const closePopover = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const windowLabel = phase === 'preparing'
    ? t('contextBreakdown.preparing')
    : showPrepared
      ? `${t('contextBreakdown.currentRequest')} ~${formatTokenCount(prepared.preparedInputTokens)} / ${formatTokenCount(prepared.promptBudgetTokens)}`
      : usage
        ? `${phase === 'actual' ? t('contextBreakdown.actual') : t('contextBreakdown.lastActual')} ${normalizedPercent}%${windowTokens ? ` ${formatTokenCount(windowTokens)}` : ''}${typeof usage.cumulativeCost === 'number' ? ` ${formatUsdCost(usage.cumulativeCost)}` : ''}`
        : `${t('contextBreakdown.noUsageYet')}${windowTokens ? ` ${formatTokenCount(windowTokens)}` : ''}`;
  const ariaLabel = phase === 'preparing'
    ? t('contextBreakdown.preparing')
    : showPrepared
      ? t('contextBreakdown.currentRequestAria', { percent: normalizedPercent })
      : usage
        ? phase === 'actual'
          ? t('contextBreakdown.actualAria', { percent: normalizedPercent })
          : t('contextBreakdown.lastActualAria', { percent: normalizedPercent })
        : t('contextBreakdown.noUsageYet');
  const valueText = phase === 'preparing'
    ? '…'
    : usage || showPrepared
      ? `${normalizedPercent}%`
      : METER_UNAVAILABLE;

  return (
    <div className="composer-usage">
      <button
        ref={triggerRef}
        type="button"
        className={`composer-usage-indicator${stale && !showPrepared ? ' is-stale' : ''}${phase === 'preparing' ? ' is-pending' : ''}`}
        data-testid="composer-usage-indicator"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={windowLabel}
        onClick={() => (open ? closePopover() : setOpen(true))}
      >
        <svg className="composer-usage-ring" width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
          <circle className="composer-usage-ring-track" cx="18" cy="18" r={radius} />
          <circle
            className="composer-usage-ring-progress"
            cx="18"
            cy="18"
            r={radius}
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={dashOffset}
          />
        </svg>
        <span className="composer-usage-value">
          <span className="composer-usage-value-number">{valueText}</span>
        </span>
      </button>
      {open ? (
        <ContextBreakdownPopover
          prepared={showPrepared ? prepared : null}
          phase={phase}
          usage={usage}
          selectedContextWindowTokens={selectedContextWindowTokens}
          stale={stale}
          onClose={closePopover}
        />
      ) : null}
    </div>
  );
};
