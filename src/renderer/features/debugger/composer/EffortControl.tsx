import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReasoningSelection } from '@shared/types/modelCapability';
import { formatTokenCount } from '@shared/utils/tokens';
import { useI18n } from '../../../i18n';
import { useTurnControls } from './useTurnControls';
import type { SessionRecord } from '@shared/types/session';
import {
  buildEffortPillPresentation,
  buildDisplaySelections,
  ChevronIcon,
  clampSliderRatio,
  EFFORT_LABEL_KEYS,
  getStopPosition,
  ReasoningLevelIcon,
  resolveNearestSnapLevel,
  resolveSelectedLevel,
} from './effortControlParts';
import { EffortControlPopup } from './EffortControlPopup';
import {
  hasSelectableFastMode,
  hasSelectableOneMillionContext,
  isOneMillionContextUnverified,
  oneMillionContextTokens,
} from './turnControlsUtils';
import { useMaxVisualController } from './useMaxVisualController';
import { createEffortSliderHandlers } from './effortSliderHandlers';
import { capabilityStatusPresentation } from './capabilityPresentation';
export const EffortControl: React.FC<{
  agentId: string;
  currentSession: SessionRecord | null;
  disabled?: boolean;
}> = ({ agentId, currentSession, disabled = false }) => {
  const { t } = useI18n();
  const { turnControls, capability, capabilityState, retryCapability, updateTurnControls } = useTurnControls(agentId, currentSession);
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
  const pointerFrameRef = useRef(0);
  const pendingDragRatioRef = useRef<number | null>(null);
  const isDragging = dragRatio !== null;
  const reasoningControl = capability?.controls.reasoning ?? null;
  const capabilityReady = capabilityState.status === 'ready' || capabilityState.status === 'refreshing';
  const capabilityKey = capability
    ? `${capability.providerId}:${capability.modelId}`
    : 'pending';

  const displayLevels = useMemo(
    () => buildDisplaySelections(reasoningControl),
    [reasoningControl],
  );
  const displayLevelsKey = displayLevels.join('|');
  const reasoningUnverified = !reasoningControl || reasoningControl.kind === 'unknown';
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
    pendingDragRatioRef.current = null;
    if (pointerFrameRef.current) {
      window.cancelAnimationFrame(pointerFrameRef.current);
      pointerFrameRef.current = 0;
    }
    resetMaxVisual();
  }, [capabilityKey, displayLevelsKey, resetMaxVisual]);

  useEffect(() => () => {
    if (pointerFrameRef.current) window.cancelAnimationFrame(pointerFrameRef.current);
  }, []);

  const effortLabel = reasoningUnverified
    ? t('composer.effort.providerManaged')
    : t(EFFORT_LABEL_KEYS[selectedLevel]);
  const tooltipLabel = reasoningUnverified
    ? t('composer.effort.unverified')
    : t(EFFORT_LABEL_KEYS[displayLevel]);
  const oneMillionTokens = oneMillionContextTokens(capability);
  const oneMillionCapability = capability?.resolvedControls?.context1m ?? null;
  const oneMillionAvailable = hasSelectableOneMillionContext(capability);
  const oneMillionUnverified = isOneMillionContextUnverified(capability);
  const fastAvailable = hasSelectableFastMode(capability);
  const statusPresentation = capabilityStatusPresentation(capabilityState);
  const capabilityStateLabel = statusPresentation.labelKey ? t(statusPresentation.labelKey) : undefined;
  const capabilityStateDetail = statusPresentation.detailKey ? t(statusPresentation.detailKey) : undefined;
  const oneMillionContextStatusLabel = !capabilityReady
    ? capabilityStateLabel
    : oneMillionCapability?.state === 'fixed'
      ? t('composer.effort.fixed')
      : oneMillionUnverified
        ? t('composer.effort.unverified')
        : undefined;
  const fastModelStatusLabel = !capabilityReady
    ? capabilityStateLabel
    : capability?.resolvedControls?.fast.state === 'fixed'
      ? t('composer.effort.fixed')
      : undefined;
  const oneMillionContextBadgeLabel = oneMillionTokens
    ? formatTokenCount(oneMillionTokens)
    : t('composer.effort.oneMillionContextBadge');
  const pillPresentation = buildEffortPillPresentation({
    reasoningLabel: effortLabel,
    oneMillionContextMode: turnControls.maxContextMode,
    oneMillionContextLabel: t('composer.effort.oneMillionContext'),
    oneMillionContextBadgeLabel,
    fastModel: turnControls.fastModel,
    fastModelLabel: t('composer.effort.fastModel'),
    fastModelBadgeLabel: t('composer.effort.fastMultiplier'),
  });

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

  const {
    handleTrackPointerDown,
    handleTrackPointerMove,
    handleTrackPointerUp,
    handleTrackClick,
    handleThumbKeyDown,
  } = createEffortSliderHandlers({
    trackRef,
    dragActiveRef,
    suppressClickRef,
    pointerFrameRef,
    pendingDragRatioRef,
    hasAdjustableReasoning,
    displayLevel,
    displayLevels,
    setSnapLevel,
    setDragRatio,
    commitEffort,
  });

  const popupStyle = { '--composer-effort-popup-shift-x': `${popupShift}px` } as React.CSSProperties;
  const thumbStyle = { left: `${thumbPercent}%` } as React.CSSProperties;
  const thumbEdgeClass = thumbPercent <= 0.01 ? ' is-start' : thumbPercent >= 99.99 ? ' is-end' : '';

  return (
    <div ref={menuRef} className="composer-effort-menu">
      <button
        type="button"
        className={`composer-effort-pill ${open ? 'open' : ''}${selectedLevel === 'max' ? ' is-level-max' : ''}`}
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
          capabilityStateLabel={capabilityStateLabel}
          capabilityStateDetail={capabilityStateDetail}
          capabilityRefreshing={statusPresentation.refreshing}
          capabilityRetryLabel={t('composer.effort.capabilityRetry')}
          onRetryCapability={retryCapability}
          reasoningUnverified={reasoningUnverified}
          reasoningStateLabel={t('composer.effort.providerManaged')}
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
          oneMillionContextAvailable={capabilityReady && oneMillionAvailable}
          oneMillionContextStatusLabel={oneMillionContextStatusLabel}
          fastModelAvailable={capabilityReady && fastAvailable}
          fastModelStatusLabel={fastModelStatusLabel}
          oneMillionContextMode={turnControls.maxContextMode}
          fastModel={turnControls.fastModel}
          t={t}
          onTrackPointerDown={handleTrackPointerDown}
          onTrackPointerMove={handleTrackPointerMove}
          onTrackPointerUp={handleTrackPointerUp}
          onTrackClick={handleTrackClick}
          onThumbKeyDown={handleThumbKeyDown}
          onToggleOneMillionContext={() => updateTurnControls({ maxContextMode: !turnControls.maxContextMode })}
          onToggleFastModel={() => updateTurnControls({ fastModel: !turnControls.fastModel })}
        />
      ) : null}
    </div>
  );
};
