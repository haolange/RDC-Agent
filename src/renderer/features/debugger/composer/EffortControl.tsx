import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReasoningSelection } from '@shared/types/modelCapability';
import { useI18n } from '../../../i18n';
import { useTurnControls } from './useTurnControls';
import type { SessionRecord } from '@shared/types/session';
import {
  buildEffortPillPresentation,
  buildDisplaySelections,
  ChevronIcon,
  clampSliderRatio,
  EFFORT_LABEL_KEYS,
  findAdjacentSupportedLevel,
  getStopPosition,
  ReasoningLevelIcon,
  resolveNearestSnapLevel,
  resolveSelectedLevel,
} from './effortControlParts';
import { EffortControlPopup } from './EffortControlPopup';
import { formatTokenCount, hasSelectableFastMode, hasSelectableMaxTier, maxContextTokens } from './turnControlsUtils';
import { useMaxVisualController } from './useMaxVisualController';
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
  const suppressClickRef = useRef(false);
  const isDragging = dragRatio !== null;
  const reasoningControl = capability?.reasoning ?? null;
  const capabilityKey = capability
    ? `${capability.providerId}:${capability.modelId}`
    : 'pending';

  const displayLevels = useMemo(
    () => buildDisplaySelections(reasoningControl),
    [reasoningControl],
  );
  const displayLevelsKey = displayLevels.join('|');
  const hasAdjustableReasoning = displayLevels.length > 1 && reasoningControl?.kind !== 'always-on';

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

  const {
    maxPhase,
    maxProgress,
    stopsOpacity,
    showMaxTrack,
    isMaxTier,
    resetMaxVisual,
    applyCommittedLevelVisual,
  } = useMaxVisualController({
    open,
    isDragging,
    displayLevel,
    selectedLevel,
  });

  useEffect(() => {
    setSnapLevel(null);
    setDragRatio(null);
    dragActiveRef.current = false;
    resetMaxVisual();
  }, [capabilityKey, displayLevelsKey, resetMaxVisual]);

  const effortLabel = t(EFFORT_LABEL_KEYS[selectedLevel]);
  const tooltipLabel = t(EFFORT_LABEL_KEYS[displayLevel]);
  const maxTokens = maxContextTokens(capability);
  const maxAvailable = hasSelectableMaxTier(capability);
  const fastAvailable = hasSelectableFastMode(capability);
  const maxContextBadgeLabel = maxTokens
    ? formatTokenCount(maxTokens)
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
  const maxContextStatus = maxAvailable
    ? (turnControls.maxContextMode ? maxContextBadgeLabel : t('composer.effort.stateOff'))
    : t('composer.effort.unavailable');
  const fastModelStatus = fastAvailable
    ? (turnControls.fastModel ? t('composer.effort.fastMultiplier') : t('composer.effort.standardMultiplier'))
    : t('composer.effort.unavailable');

  const closeMenu = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
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
    applyCommittedLevelVisual(level);
  }, [applyCommittedLevelVisual, displayLevels, updateTurnControls]);

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
    setDragRatio(getRatioFromClientX(event.clientX));
  };

  const handleTrackPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragActiveRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    commitEffort(resolveLevelFromClientX(event.clientX));
    dragActiveRef.current = false;
    setDragRatio(null);
    suppressClickRef.current = true;
  };

  const handleTrackClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!hasAdjustableReasoning) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
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
  const thumbEdgeClass = thumbPercent <= 0.01 ? ' is-start' : thumbPercent >= 99.99 ? ' is-end' : '';

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
        <EffortControlPopup
          popupRef={popupRef}
          popupStyle={popupStyle}
          trackRef={trackRef}
          hasAdjustableReasoning={hasAdjustableReasoning}
          displayLevel={displayLevel}
          displayLevels={displayLevels}
          displayIndex={displayIndex}
          isDragging={isDragging}
          isMaxTier={isMaxTier}
          showMaxTrack={showMaxTrack}
          maxPhase={maxPhase}
          maxProgress={maxProgress}
          thumbRatio={thumbRatio}
          stopsOpacity={stopsOpacity}
          thumbStyle={thumbStyle}
          thumbEdgeClass={thumbEdgeClass}
          tooltipLabel={tooltipLabel}
          maxContextStatus={maxContextStatus}
          fastModelStatus={fastModelStatus}
          maxContextAvailable={maxAvailable}
          fastModelAvailable={fastAvailable}
          maxContextMode={turnControls.maxContextMode}
          fastModel={turnControls.fastModel}
          t={t}
          onTrackPointerDown={handleTrackPointerDown}
          onTrackPointerMove={handleTrackPointerMove}
          onTrackPointerUp={handleTrackPointerUp}
          onTrackClick={handleTrackClick}
          onThumbKeyDown={handleThumbKeyDown}
          onToggleMaxContext={() => updateTurnControls({ maxContextMode: !turnControls.maxContextMode })}
          onToggleFastModel={() => updateTurnControls({ fastModel: !turnControls.fastModel })}
        />
      ) : null}
    </div>
  );
};
