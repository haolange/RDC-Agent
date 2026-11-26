import React, { useCallback, useState } from 'react';
import { useI18n } from '../i18n';
import { awaitsExecutionContextWindow, type ContextUsageSelectedProfile } from './contextUsageDisplay';
import { ContextBreakdownSheet } from './ContextBreakdownSheet';
import type { PreparedTurnContextSummary, RunContextUsageSummary } from '@shared/types/session';

type PreparationPhase = 'idle' | 'preparing' | 'current' | 'actual';

const METER_UNAVAILABLE = '—';

export interface ContextUsageMenuController {
  open: boolean;
  toggle: () => void;
  close: () => void;
}

export const ContextUsageIndicator: React.FC<{
  usage: RunContextUsageSummary | null;
  prepared: PreparedTurnContextSummary | null;
  phase: PreparationPhase;
  selectedProfile: ContextUsageSelectedProfile | null;
  stale?: boolean;
  estimated?: boolean;
  menu?: ContextUsageMenuController;
  detailsExpanded: boolean;
  detailsSaveError?: string;
  onDetailsExpandedChange: (expanded: boolean) => void;
}> = ({
  usage,
  prepared,
  phase,
  selectedProfile,
  stale = false,
  estimated = false,
  menu,
  detailsExpanded,
  detailsSaveError,
  onDetailsExpandedChange,
}) => {
  const { t } = useI18n();
  const [localOpen, setLocalOpen] = useState(false);
  const open = menu?.open ?? localOpen;
  const showPrepared = phase === 'current' && prepared !== null;
  const awaitingWindow = showPrepared && awaitsExecutionContextWindow(prepared);
  const previewActive = estimated && !showPrepared && usage !== null;
  const showEstimatedRing = previewActive && phase !== 'preparing';
  const usagePercent = showPrepared ? prepared.usagePercent : (usage?.usagePercent ?? 0);
  const normalizedPercent = awaitingWindow ? 0 : Math.max(0, Math.min(100, usagePercent));
  const radius = 16.5;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - normalizedPercent / 100);
  const percentLabel = showEstimatedRing ? `~${normalizedPercent}%` : `${normalizedPercent}%`;

  const closePopover = useCallback(() => {
    if (menu) {
      menu.close();
      return;
    }
    setLocalOpen(false);
  }, [menu]);
  const togglePopover = useCallback(() => {
    if (menu) {
      menu.toggle();
      return;
    }
    setLocalOpen((current) => !current);
  }, [menu]);

  const ariaLabel =
    phase === 'preparing'
      ? t('contextBreakdown.preparing')
      : awaitingWindow
        ? t('contextBreakdown.windowPendingAria')
        : showPrepared
          ? t('contextBreakdown.currentRequestAria', { percent: normalizedPercent })
          : previewActive
            ? t('contextBreakdown.projectedAria', { percent: normalizedPercent })
            : usage
              ? phase === 'actual'
                ? t('contextBreakdown.actualAria', { percent: normalizedPercent })
                : t('contextBreakdown.lastActualAria', { percent: normalizedPercent })
              : t('contextBreakdown.noUsageYet');
  const valueText =
    phase === 'preparing' || awaitingWindow ? '…' : usage || showPrepared ? percentLabel : METER_UNAVAILABLE;

  return (
    <div className="composer-usage">
      <button
        type="button"
        className={`composer-usage-indicator${stale && !showPrepared ? ' is-stale' : ''}${phase === 'preparing' || awaitingWindow ? ' is-pending' : ''}${showEstimatedRing ? ' is-estimated' : ''}`}
        data-testid="composer-usage-indicator"
        data-estimated={showEstimatedRing ? 'true' : undefined}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tooltip={ariaLabel}
        onClick={togglePopover}
      >
        <svg className="composer-usage-ring" viewBox="0 0 36 36" aria-hidden="true">
          <circle className="composer-usage-ring-track" cx="18" cy="18" r={radius} />
          <circle
            className="composer-usage-ring-progress"
            cx="18"
            cy="18"
            r={radius}
            strokeDasharray={normalizedPercent >= 100 ? undefined : `${circumference} ${circumference}`}
            strokeDashoffset={normalizedPercent >= 100 ? undefined : dashOffset}
            visibility={normalizedPercent <= 0 || phase === 'preparing' || awaitingWindow ? 'hidden' : undefined}
          />
        </svg>
        <span className="composer-usage-value">
          <span className="composer-usage-value-number">{valueText}</span>
        </span>
      </button>
      <ContextBreakdownSheet
        open={open}
        prepared={showPrepared ? prepared : null}
        phase={phase}
        usage={usage}
        selectedProfile={selectedProfile}
        stale={stale}
        estimated={previewActive}
        detailsExpanded={detailsExpanded}
        detailsSaveError={detailsSaveError}
        onDetailsExpandedChange={onDetailsExpandedChange}
        onClose={closePopover}
      />
    </div>
  );
};
