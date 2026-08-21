import React, { useCallback, useRef, useState } from 'react';
import type { PreparedTurnContextSummary, RunContextUsageSummary } from '@shared/types/session';
import { ContextBreakdownPopover } from './ContextBreakdownPopover';
import {
  resolveDisplayedCompactionThreshold,
  resolveDisplayedPromptBudget,
  type ContextUsageSelectedProfile,
} from './contextUsageDisplay';
import { formatTokenCount } from '@shared/utils/tokens';
import { formatUsdCost } from '@shared/utils/cost';
import { useI18n } from '../i18n';

type PreparationPhase = 'idle' | 'preparing' | 'current' | 'actual';

const METER_UNAVAILABLE = '—';

export const ContextUsageIndicator: React.FC<{
  usage: RunContextUsageSummary | null;
  prepared: PreparedTurnContextSummary | null;
  phase: PreparationPhase;
  selectedProfile: ContextUsageSelectedProfile | null;
  stale?: boolean;
  estimated?: boolean;
}> = ({ usage, prepared, phase, selectedProfile, stale = false, estimated = false }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const showPrepared = phase === 'current' && prepared !== null;
  const previewActive = estimated && !showPrepared && usage !== null;
  const showEstimatedRing = previewActive && phase !== 'preparing';
  const usagePercent = showPrepared ? prepared.usagePercent : usage?.usagePercent ?? 0;
  const normalizedPercent = Math.max(0, Math.min(100, usagePercent));
  const windowTokens = resolveDisplayedPromptBudget(showPrepared, prepared, usage, selectedProfile);
  const thresholdTokens = resolveDisplayedCompactionThreshold(
    showPrepared, prepared, usage, selectedProfile,
  );
  const thresholdRatio = typeof thresholdTokens === 'number'
    && typeof windowTokens === 'number'
    && windowTokens > 0
    ? Math.max(0, Math.min(1, thresholdTokens / windowTokens))
    : null;
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - (normalizedPercent / 100));
  const thresholdDashoffset = thresholdRatio == null
    ? 0
    : circumference * (1 - thresholdRatio);
  const percentLabel = showEstimatedRing ? `~${normalizedPercent}%` : `${normalizedPercent}%`;

  const closePopover = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const windowLabel = phase === 'preparing'
    ? t('contextBreakdown.preparing')
    : showPrepared
      ? `${t('contextBreakdown.currentRequest')} ~${formatTokenCount(prepared.preparedInputTokens)} / ${formatTokenCount(prepared.promptBudgetTokens)}`
      : previewActive
        ? `${t('contextBreakdown.projected')} ${percentLabel}${windowTokens ? ` ${formatTokenCount(windowTokens)}` : ''}`
        : usage
          ? `${phase === 'actual' ? t('contextBreakdown.actual') : t('contextBreakdown.lastActual')} ${normalizedPercent}%${windowTokens ? ` ${formatTokenCount(windowTokens)}` : ''}${typeof usage.cumulativeCost === 'number' ? ` ${formatUsdCost(usage.cumulativeCost)}` : ''}`
          : `${t('contextBreakdown.noUsageYet')}${windowTokens ? ` ${formatTokenCount(windowTokens)}` : ''}`;
  const ariaLabel = phase === 'preparing'
    ? t('contextBreakdown.preparing')
    : showPrepared
      ? t('contextBreakdown.currentRequestAria', { percent: normalizedPercent })
      : previewActive
        ? t('contextBreakdown.projectedAria', { percent: normalizedPercent })
        : usage
          ? phase === 'actual'
            ? t('contextBreakdown.actualAria', { percent: normalizedPercent })
            : t('contextBreakdown.lastActualAria', { percent: normalizedPercent })
          : t('contextBreakdown.noUsageYet');
  const valueText = phase === 'preparing'
    ? '…'
    : usage || showPrepared
      ? percentLabel
      : METER_UNAVAILABLE;

  return (
    <div className="composer-usage">
      <button
        ref={triggerRef}
        type="button"
        className={`composer-usage-indicator${stale && !showPrepared ? ' is-stale' : ''}${phase === 'preparing' ? ' is-pending' : ''}${showEstimatedRing ? ' is-estimated' : ''}`}
        data-testid="composer-usage-indicator"
        data-estimated={showEstimatedRing ? 'true' : undefined}
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
          {thresholdRatio != null ? (
            <circle
              className="composer-usage-ring-threshold"
              data-testid="composer-usage-ring-threshold"
              cx="18"
              cy="18"
              r={radius}
              strokeDasharray={`2 ${circumference - 2}`}
              strokeDashoffset={thresholdDashoffset}
            />
          ) : null}
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
          selectedProfile={selectedProfile}
          stale={stale}
          estimated={previewActive}
          onClose={closePopover}
        />
      ) : null}
    </div>
  );
};
