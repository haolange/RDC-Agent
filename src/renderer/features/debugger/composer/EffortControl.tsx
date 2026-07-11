import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  clampReasoningSelection,
  type ReasoningControl,
  type ReasoningSelection,
} from '@shared/types/modelCapability';
import { useI18n } from '../../../i18n';
import { useTurnControls } from './useTurnControls';
import type { SessionRecord } from '@shared/types/session';
import {
  buildEffortPillPresentation,
  buildDisplaySelections,
  ChevronIcon,
  clampSliderRatio,
  EFFORT_LABEL_KEYS,
  EffortFastModeSwitchRow,
  EffortMaxContextSwitchRow,
  findAdjacentSupportedLevel,
  getStopPosition,
  ReasoningLevelIcon,
  resolveNearestSnapLevel,
} from './effortControlParts';
import { EffortMaxSparks } from './EffortMaxSparks';
import { formatTokenCount } from './turnControlsUtils';

function resolveSelectedLevel(
  reasoningLevel: ReasoningSelection,
  reasoningControl: ReasoningControl | null,
  displayLevels: ReasoningSelection[],
): ReasoningSelection {
  if (!reasoningControl) {
    return displayLevels[0] ?? 'off';
  }
  const clamped = clampReasoningSelection(reasoningLevel, reasoningControl)
    ?? reasoningControl.defaultSelection;
  if (displayLevels.includes(clamped)) {
    return clamped;
  }
  return displayLevels[displayLevels.length - 1] ?? 'off';
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
  const [snapLevel, setSnapLevel] = useState<ReasoningSelection | null>(null);
  const [popupShift, setPopupShift] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragActiveRef = useRef(false);
  const popupShiftRef = useRef(0);
  const isDragging = dragRatio !== null;
  const reasoningControl = capability?.reasoningControl ?? null;
  const capabilityKey = capability
    ? `${capability.providerId}:${capability.modelId}`
    : 'pending';

  const displayLevels = useMemo(
    () => buildDisplaySelections(reasoningControl),
    [reasoningControl],
  );
  const displayLevelsKey = displayLevels.join('|');
  const hasAdjustableReasoning = displayLevels.length > 1 && reasoningControl?.kind !== 'always-on';

  useEffect(() => {
    setSnapLevel(null);
    setDragRatio(null);
    dragActiveRef.current = false;
  }, [capabilityKey, displayLevelsKey]);

  const selectedLevel = resolveSelectedLevel(
    turnControls.reasoningLevel,
    reasoningControl,
    displayLevels,
  );

  useEffect(() => {
    if (snapLevel !== null && selectedLevel === snapLevel) {
      setSnapLevel(null);
    }
  }, [selectedLevel, snapLevel]);

  const validSnapLevel = snapLevel && displayLevels.includes(snapLevel) ? snapLevel : null;
  const displayLevel = isDragging
    ? resolveNearestSnapLevel(dragRatio, displayLevels)
    : (validSnapLevel ?? selectedLevel);
  const displayIndex = Math.max(0, displayLevels.indexOf(displayLevel));
  const thumbRatio = isDragging
    ? clampSliderRatio(dragRatio)
    : getStopPosition(displayIndex, displayLevels.length);
  const thumbPercent = thumbRatio * 100;
  const isMaxTier = displayLevel === 'max' || displayLevel === 'ultra';

  const effortLabel = t(EFFORT_LABEL_KEYS[selectedLevel]);
  const tooltipLabel = t(EFFORT_LABEL_KEYS[displayLevel]);
  const maxContextBadgeLabel = capability?.maxContextWindowTokens
    ? formatTokenCount(capability.maxContextWindowTokens)
    : t('composer.effort.maxContextBadge');
  const pillPresentation = buildEffortPillPresentation({
    reasoningLabel: effortLabel,
    maxContextMode: turnControls.maxContextMode,
    maxContextLabel: t('composer.effort.maxContext'),
    maxContextBadgeLabel,
    fastModel: turnControls.fastModel,
    fastModelLabel: t('composer.effort.fastModel'),
    fastModelBadgeLabel: t('composer.effort.fastMultiplier'),
  });
  const maxContextStatus = capability?.maxContextAvailable
    ? turnControls.maxContextMode ? maxContextBadgeLabel : t('composer.effort.stateOff')
    : t('composer.effort.unavailable');
  const fastModelStatus = capability?.fastModelAvailable
    ? turnControls.fastModel ? t('composer.effort.fastMultiplier') : t('composer.effort.standardMultiplier')
    : t('composer.effort.unavailable');

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

  useLayoutEffect(() => {
    if (!open) return undefined;
    const syncPopupPosition = () => {
      const popup = popupRef.current;
      if (!popup) return;
      const gutter = 8;
      const currentShift = popupShiftRef.current;
      const rect = popup.getBoundingClientRect();
      const boundary = menuRef.current?.closest('.composer-shell')?.getBoundingClientRect();
      const minLeft = Math.max(gutter, boundary ? boundary.left + gutter : gutter);
      const maxRight = Math.min(window.innerWidth - gutter, boundary ? boundary.right - gutter : window.innerWidth - gutter);
      const baseLeft = rect.left - currentShift;
      const baseRight = rect.right - currentShift;
      let nextShift = 0;
      if (baseRight > maxRight) nextShift -= baseRight - maxRight;
      if (baseLeft + nextShift < minLeft) nextShift += minLeft - (baseLeft + nextShift);
      popupShiftRef.current = Math.round(nextShift);
      setPopupShift(popupShiftRef.current);
    };
    syncPopupPosition();
    window.addEventListener('resize', syncPopupPosition);
    return () => window.removeEventListener('resize', syncPopupPosition);
  }, [open]);

  const commitEffort = useCallback((level: ReasoningSelection) => {
    if (!displayLevels.includes(level)) return;
    setSnapLevel(level);
    updateTurnControls({ reasoningLevel: level });
  }, [displayLevels, updateTurnControls]);

  const getRatioFromClientX = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return clampSliderRatio((clientX - rect.left) / rect.width);
  };

  const resolveLevelFromClientX = (clientX: number): ReasoningSelection => {
    const track = trackRef.current;
    if (!track) return displayLevels[0] ?? 'off';
    const rect = track.getBoundingClientRect();
    return resolveNearestSnapLevel((clientX - rect.left) / rect.width, displayLevels);
  };

  const handleTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!hasAdjustableReasoning) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const ratio = getRatioFromClientX(event.clientX);
    dragActiveRef.current = true;
    setSnapLevel(null);
    setDragRatio(ratio);
  };

  const handleTrackPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragActiveRef.current || !hasAdjustableReasoning) return;
    const ratio = getRatioFromClientX(event.clientX);
    setDragRatio(ratio);
  };

  const handleTrackPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragActiveRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const level = resolveLevelFromClientX(event.clientX);
    commitEffort(level);
    dragActiveRef.current = false;
    setDragRatio(null);
  };

  const handleTrackClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!hasAdjustableReasoning) return;
    commitEffort(resolveLevelFromClientX(event.clientX));
  };

  const handleThumbKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasAdjustableReasoning) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = findAdjacentSupportedLevel(displayLevel, -1, displayLevels);
      if (next) commitEffort(next);
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = findAdjacentSupportedLevel(displayLevel, 1, displayLevels);
      if (next) commitEffort(next);
    }
  };

  const popupStyle = { '--composer-effort-popup-shift-x': `${popupShift}px` } as React.CSSProperties;
  const thumbStyle = { left: `${thumbPercent}%` } as React.CSSProperties;
  const thumbEdgeClass = thumbPercent <= 0.01
    ? ' is-start'
    : thumbPercent >= 99.99
      ? ' is-end'
      : '';

  return (
    <div ref={menuRef} className="composer-effort-menu">
      <button
        type="button"
        className={`composer-effort-pill ${open ? 'open' : ''}${selectedLevel === 'max' || selectedLevel === 'ultra' ? ` is-level-${selectedLevel}` : ''}`}
        data-testid="composer-effort-pill"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        title={pillPresentation.title}
        aria-label={pillPresentation.title}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="composer-effort-pill-icon" aria-hidden="true">
          <ReasoningLevelIcon level={selectedLevel} />
        </span>
        <span className="composer-effort-pill-label">{pillPresentation.label}</span>
        {pillPresentation.badges.length > 0 ? (
          <span className="composer-effort-pill-modes" aria-hidden="true">
            {pillPresentation.badges.map((badge) => (
              <span key={badge.mode} className="composer-effort-pill-mode" data-mode={badge.mode}>
                {badge.label}
              </span>
            ))}
          </span>
        ) : null}
        <span className="composer-effort-pill-caret" aria-hidden="true"><ChevronIcon /></span>
      </button>

      {open ? (
        <div ref={popupRef} className="composer-effort-popup" data-testid="composer-effort-popup" role="dialog" aria-label={t('composer.effort.popupTitle')} style={popupStyle}>
          <div className={`composer-effort-slider-section ${hasAdjustableReasoning ? '' : 'is-disabled'}`}>
            <div
              ref={trackRef}
              className={`composer-effort-slider is-level-${displayLevel}${hasAdjustableReasoning ? '' : ' is-disabled'}${isDragging ? ' is-dragging' : ''}`}
              data-testid="composer-effort-slider"
              onPointerDown={handleTrackPointerDown}
              onPointerMove={handleTrackPointerMove}
              onPointerUp={handleTrackPointerUp}
              onPointerCancel={handleTrackPointerUp}
              onClick={handleTrackClick}
            >
              {hasAdjustableReasoning ? (
                <div className="composer-effort-slider-stops" aria-hidden="true">
                  {displayLevels.map((level, index) => {
                    const classes = [
                      'composer-effort-slider-stop',
                      level === displayLevel ? 'is-current' : '',
                    ].filter(Boolean).join(' ');
                    return (
                      <div
                        key={level}
                        className={classes}
                        style={{ left: `${getStopPosition(index, displayLevels.length) * 100}%` }}
                      />
                    );
                  })}
                </div>
              ) : null}

              <div className="composer-effort-slider-track" aria-hidden="true">
                {isMaxTier ? <EffortMaxSparks /> : null}
              </div>

              <div
                className={`composer-effort-slider-thumb${isDragging ? ' is-dragging' : ''}${thumbEdgeClass}`}
                style={thumbStyle}
                role="slider"
                tabIndex={hasAdjustableReasoning ? 0 : -1}
                aria-valuemin={0}
                aria-valuemax={displayLevels.length - 1}
                aria-valuenow={displayIndex}
                aria-valuetext={t(EFFORT_LABEL_KEYS[displayLevel])}
                aria-disabled={!hasAdjustableReasoning}
                onKeyDown={handleThumbKeyDown}
              >
                {isDragging ? <span className="composer-effort-slider-tooltip">{tooltipLabel}</span> : null}
              </div>
            </div>

            <div className="composer-effort-slider-labels" aria-hidden="true">
              <span>{t('composer.effort.faster')}</span>
              <span>{t('composer.effort.smarter')}</span>
            </div>
          </div>

          <div className="composer-effort-popup-divider" aria-hidden="true" />

          <EffortMaxContextSwitchRow
            label={t('composer.effort.maxContext')}
            status={maxContextStatus}
            available={Boolean(capability?.maxContextAvailable)}
            active={turnControls.maxContextMode}
            onToggle={() => updateTurnControls({ maxContextMode: !turnControls.maxContextMode })}
          />

          <EffortFastModeSwitchRow
            label={t('composer.effort.fastModel')}
            status={fastModelStatus}
            available={Boolean(capability?.fastModelAvailable)}
            active={turnControls.fastModel}
            onToggle={() => updateTurnControls({ fastModel: !turnControls.fastModel })}
          />
        </div>
      ) : null}
    </div>
  );
};
