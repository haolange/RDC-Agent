import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EFFORT_LEVELS, type EffortLevel } from '@shared/types/modelCapability';
import { useI18n } from '../../../i18n';
import { formatTokenCount } from './turnControlsUtils';
import { useTurnControls } from './useTurnControls';
import type { SessionRecord } from '@shared/types/session';
import { ChevronIcon, findAdjacentSupportedLevel, LightningIcon } from './effortControlParts';

const EFFORT_LABEL_KEYS = {
  low: 'composer.effort.levelLow',
  medium: 'composer.effort.levelMedium',
  high: 'composer.effort.levelHigh',
  extra: 'composer.effort.levelExtra',
  max: 'composer.effort.levelMax',
} as const;

const SNAP_RADIUS = 0.12;
const STOP_POSITIONS = EFFORT_LEVELS.map((_, i) => i / (EFFORT_LEVELS.length - 1));

function resolveSnappedLevel(ratio: number, supported: EffortLevel[]): EffortLevel | null {
  for (const level of supported) {
    const pos = STOP_POSITIONS[EFFORT_LEVELS.indexOf(level)];
    if (Math.abs(ratio - pos) <= SNAP_RADIUS) return level;
  }
  return null;
}

function resolveNearestLevel(ratio: number, supported: EffortLevel[]): EffortLevel {
  return supported.reduce((best, level) => {
    const pos = STOP_POSITIONS[EFFORT_LEVELS.indexOf(level)];
    const bestPos = STOP_POSITIONS[EFFORT_LEVELS.indexOf(best)];
    return Math.abs(ratio - pos) < Math.abs(ratio - bestPos) ? level : best;
  });
}

export const EffortControl: React.FC<{
  agentId: string;
  currentSession: SessionRecord | null;
  disabled?: boolean;
}> = ({ agentId, currentSession, disabled = false }) => {
  const { t } = useI18n();
  const { turnControls, capability, updateTurnControls } = useTurnControls(agentId, currentSession);
  const [open, setOpen] = useState(false);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = dragRatio !== null;

  const supportedLevels = capability?.supportedEffortLevels ?? [];
  const hasReasoning = supportedLevels.length > 0;
  const selectedIndex = EFFORT_LEVELS.indexOf(turnControls.effort);
  const thumbPercent = isDragging
    ? dragRatio * 100
    : (selectedIndex / (EFFORT_LEVELS.length - 1)) * 100;

  const effortLabel = t(EFFORT_LABEL_KEYS[turnControls.effort]);

  // Tooltip text reflects the snapped level while dragging for live feedback
  const tooltipLevel = isDragging
    ? (resolveSnappedLevel(dragRatio, supportedLevels) ?? resolveNearestLevel(dragRatio, supportedLevels.length > 0 ? supportedLevels : [turnControls.effort]))
    : turnControls.effort;
  const tooltipLabel = t(EFFORT_LABEL_KEYS[tooltipLevel]);

  const pillLabel = turnControls.maxContextMode ? `${effortLabel} · Max` : effortLabel;

  const maxModeSubtitle = useMemo(() => {
    if (!capability) return '';
    const from = formatTokenCount(capability.defaultContextWindowTokens);
    if (!capability.maxContextWindowTokens) return from;
    return `${from} → ${formatTokenCount(capability.maxContextWindowTokens)}`;
  }, [capability]);

  const fastModelSubtitle = capability?.fastVariantModelId ? `→ ${capability.fastVariantModelId}` : '';
  const maxModeTooltip = capability?.nominalContextWindowTokens === null
    ? t('composer.effort.maxContextUnknown')
    : t('composer.effort.maxContextUnavailable');

  const closeMenu = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu();
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [closeMenu, open]);

  const selectEffort = useCallback((level: EffortLevel) => {
    if (supportedLevels.includes(level)) updateTurnControls({ effort: level });
  }, [supportedLevels, updateTurnControls]);

  const getRatioFromClientX = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const handleTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!hasReasoning) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const ratio = getRatioFromClientX(event.clientX);
    setDragRatio(ratio);
    const snapped = resolveSnappedLevel(ratio, supportedLevels);
    if (snapped) selectEffort(snapped);
  };

  const handleTrackPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !hasReasoning) return;
    const ratio = getRatioFromClientX(event.clientX);
    setDragRatio(ratio);
    const snapped = resolveSnappedLevel(ratio, supportedLevels);
    if (snapped) selectEffort(snapped);
  };

  const handleTrackPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const ratio = dragRatio ?? getRatioFromClientX(event.clientX);
    const snapped = resolveSnappedLevel(ratio, supportedLevels);
    if (!snapped && supportedLevels.length > 0) {
      selectEffort(resolveNearestLevel(ratio, supportedLevels));
    }
    setDragRatio(null);
  };

  const handleThumbKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasReasoning) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = findAdjacentSupportedLevel(turnControls.effort, -1, supportedLevels);
      if (next) selectEffort(next);
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = findAdjacentSupportedLevel(turnControls.effort, 1, supportedLevels);
      if (next) selectEffort(next);
    }
  };

  // Index of the highest supported level, used for the accent dot
  const maxSupportedIndex = supportedLevels.length > 0
    ? EFFORT_LEVELS.indexOf(supportedLevels[supportedLevels.length - 1])
    : -1;

  return (
    <div ref={menuRef} className="composer-effort-menu">
      <button
        type="button"
        className={`composer-effort-pill ${open ? 'open' : ''}`}
        data-testid="composer-effort-pill"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        title={pillLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="composer-effort-pill-icon" aria-hidden="true">
          <LightningIcon />
          {turnControls.fastModel ? <span className="composer-effort-fast-badge" aria-hidden="true">2x</span> : null}
        </span>
        <span className="composer-effort-pill-label">{pillLabel}</span>
        <span className="composer-effort-pill-caret" aria-hidden="true"><ChevronIcon /></span>
      </button>

      {open ? (
        <div className="composer-effort-popup" data-testid="composer-effort-popup" role="dialog" aria-label={t('composer.effort.popupTitle')}>
          <div className={`composer-effort-slider-section ${hasReasoning ? '' : 'is-disabled'}`}>
            <div
              ref={trackRef}
              className={`composer-effort-slider${isDragging ? ' is-dragging' : ''}`}
              data-testid="composer-effort-slider"
              onPointerDown={handleTrackPointerDown}
              onPointerMove={handleTrackPointerMove}
              onPointerUp={handleTrackPointerUp}
              onPointerCancel={handleTrackPointerUp}
            >
              {/* Pure-visual stop markers — not interactive */}
              <div className="composer-effort-slider-stops" aria-hidden="true">
                {EFFORT_LEVELS.map((level, index) => {
                  const isSupported = supportedLevels.includes(level);
                  const isMaxSupported = index === maxSupportedIndex;
                  const classes = [
                    'composer-effort-slider-stop',
                    !isSupported ? 'is-unsupported' : '',
                    isMaxSupported ? 'is-max-supported' : '',
                  ].filter(Boolean).join(' ');
                  return (
                    <div
                      key={level}
                      className={classes}
                      style={{ left: `${STOP_POSITIONS[index] * 100}%` }}
                    />
                  );
                })}
              </div>

              <div className="composer-effort-slider-track" aria-hidden="true" />

              {/* Accessible slider thumb */}
              <div
                className={`composer-effort-slider-thumb${isDragging ? ' is-dragging' : ''}`}
                role="slider"
                tabIndex={hasReasoning ? 0 : -1}
                aria-valuemin={0}
                aria-valuemax={EFFORT_LEVELS.length - 1}
                aria-valuenow={selectedIndex}
                aria-valuetext={effortLabel}
                aria-disabled={!hasReasoning}
                style={{ left: `${thumbPercent}%` }}
                onKeyDown={handleThumbKeyDown}
              >
                {isDragging ? <span className="composer-effort-slider-tooltip">{tooltipLabel}</span> : null}
              </div>
            </div>

            <div className="composer-effort-slider-labels" aria-hidden="true">
              <span>{t('composer.effort.faster')}</span>
              <span>{t('composer.effort.smarter')}</span>
            </div>

            {!hasReasoning ? <p className="composer-effort-slider-hint">{t('composer.effort.noReasoning')}</p> : null}
          </div>

          <div className="composer-effort-popup-divider" aria-hidden="true" />

          <div
            className={`composer-effort-toggle-row ${capability?.maxContextAvailable ? '' : 'is-disabled'}`}
            data-testid="composer-effort-max-row"
            title={capability?.maxContextAvailable ? undefined : maxModeTooltip}
          >
            <div className="composer-effort-toggle-copy">
              <span className="composer-effort-toggle-label">{t('composer.effort.maxMode')}</span>
              <span className="composer-effort-toggle-desc">{maxModeSubtitle}</span>
            </div>
            <button
              type="button"
              role="switch"
              className={`composer-effort-toggle ${turnControls.maxContextMode ? 'active' : ''}`}
              aria-checked={turnControls.maxContextMode}
              disabled={!capability?.maxContextAvailable}
              onClick={() => updateTurnControls({ maxContextMode: !turnControls.maxContextMode })}
            />
          </div>

          <div
            className={`composer-effort-toggle-row ${capability?.fastModelAvailable ? '' : 'is-disabled'}`}
            data-testid="composer-effort-fast-row"
            title={capability?.fastModelAvailable ? undefined : t('composer.effort.fastModelUnavailable')}
          >
            <div className="composer-effort-toggle-copy">
              <span className="composer-effort-toggle-label">{t('composer.effort.fastModel')}</span>
              <span className="composer-effort-toggle-desc">{fastModelSubtitle}</span>
            </div>
            <button
              type="button"
              role="switch"
              className={`composer-effort-toggle ${turnControls.fastModel ? 'active' : ''}`}
              aria-checked={turnControls.fastModel}
              disabled={!capability?.fastModelAvailable}
              onClick={() => updateTurnControls({ fastModel: !turnControls.fastModel })}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
};
