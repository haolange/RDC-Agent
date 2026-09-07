import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useComposerMenu } from './useComposerMenuRegistry';
import type { ReasoningSelection } from '@shared/types/modelCapability';
import { formatTokenCount } from '@shared/utils/tokens';
import { useI18n } from '../../i18n';
import { Pill } from '../../ui/Pill';
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
import {
  clampCenteredTooltipPercent,
  EFFORT_THUMB_WIDTH_PX,
  thumbInsetPercent,
} from './effortSliderGeometry';
import { EffortControlPopup } from './EffortControlPopup';
import {
  hasSelectableFastMode,
  hasSelectableMaxContext,
  isFastModeUnverified,
  isMaxContextUnverified,
  maxContextTokens,
} from '../../lib/turnControlsUtils';
import { useMaxVisualController } from './useMaxVisualController';
import { createEffortSliderHandlers } from './effortSliderHandlers';
import { capabilityStatusPresentation } from './capabilityPresentation';
import { buildEffortCapabilityStatusLabels } from './effortControlStatusLabels';
import { useEffortPopupLayout } from './useEffortPopupLayout';

export const EffortControl: React.FC<{
  agentId: string;
  currentSession: SessionRecord | null;
  disabled?: boolean;
}> = ({ agentId, currentSession, disabled = false }) => {
  const { t } = useI18n();
  const { turnControls, capability, capabilityState, retryCapability, updateTurnControls } = useTurnControls(agentId, currentSession);
  const menu = useComposerMenu('effort');
  const open = menu.open;
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const [snapLevel, setSnapLevel] = useState<ReasoningSelection | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragActiveRef = useRef(false);
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
  const reasoningLockedDisabled = !reasoningControl
    || reasoningControl.kind === 'unknown'
    || reasoningControl.kind === 'none';
  const hasAdjustableReasoning = !reasoningLockedDisabled
    && displayLevels.length > 1
    && reasoningControl?.kind !== 'always-on';

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

  const {
    maxTimeline,
    showMaxTrack,
    exitingMaxPhase,
    resetMaxVisual,
    applyCommittedLevelVisual,
    completeMaxTimeline,
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

  const effortLabel = t(
    reasoningLockedDisabled ? 'composer.effort.levelOff' : EFFORT_LABEL_KEYS[selectedLevel],
  );
  const tooltipLabel = t(
    reasoningLockedDisabled ? 'composer.effort.levelOff' : EFFORT_LABEL_KEYS[displayLevel],
  );
  const maxContextTokenCount = maxContextTokens(capability);
  const maxContextAvailable = hasSelectableMaxContext(capability);
  const maxTierUnverified = isMaxContextUnverified(capability);
  const fastAvailable = hasSelectableFastMode(capability);
  const fastUnverified = isFastModeUnverified(capability);
  const statusPresentation = capabilityStatusPresentation(capabilityState);
  const capabilityStateLabel = statusPresentation.labelKey ? t(statusPresentation.labelKey) : undefined;
  const capabilityStateDetail = statusPresentation.detailKey ? t(statusPresentation.detailKey) : undefined;
  const { maxContextStatusLabel, fastModelStatusLabel } = buildEffortCapabilityStatusLabels({
    capability,
    capabilityReady,
    capabilityStateLabel,
    maxTierUnverified,
    fastUnverified,
    t,
  });
  const maxContextBadgeLabel = maxContextTokenCount
    ? formatTokenCount(maxContextTokenCount)
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
  const assignMenuRoot = useCallback((node: HTMLDivElement | null) => {
    menuRef.current = node;
    menu.setRoot(node);
  }, [menu]);
  const assignMenuTrigger = useCallback((node: HTMLButtonElement | null) => {
    menu.setTrigger(node);
  }, [menu]);

  const trackObserveKey = [
    capabilityStateLabel ?? '',
    reasoningLockedDisabled ? '1' : '0',
    hasAdjustableReasoning ? '1' : '0',
    displayLevelsKey,
  ].join('|');
  const { popupShift, trackWidthPx, positionTransitionsReady } = useEffortPopupLayout({
    open,
    menuRef,
    popupRef,
    trackRef,
    trackObserveKey,
  });
  const thumbPercent = thumbInsetPercent(thumbRatio, trackWidthPx, EFFORT_THUMB_WIDTH_PX);
  const tooltipWidthPx = Math.max(96, Math.ceil(tooltipLabel.length * 8 + 24));
  const tooltipLeftPercent = clampCenteredTooltipPercent(thumbPercent, trackWidthPx, tooltipWidthPx);

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

  return (
    <div ref={assignMenuRoot} className="composer-effort-menu">
      <Pill
        ref={assignMenuTrigger}
        className={`composer-effort-pill ${open ? 'open' : ''}${selectedLevel === 'max' ? ' is-level-max' : ''}`}
        selected={open}
        data-testid="composer-effort-pill"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        title={pillPresentation.title}
        aria-label={pillPresentation.title}
        onClick={() => menu.toggle()}
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
      </Pill>

      {open ? (
        <EffortControlPopup
          popupRef={popupRef}
          popupShiftPx={popupShift}
          trackRef={trackRef}
          capabilityStateLabel={capabilityStateLabel}
          capabilityStateDetail={capabilityStateDetail}
          capabilityRefreshing={statusPresentation.refreshing}
          capabilityRetryLabel={t('composer.effort.capabilityRetry')}
          onRetryCapability={retryCapability}
          hasAdjustableReasoning={hasAdjustableReasoning}
          displayLevel={displayLevel}
          displayLevels={displayLevels}
          displayIndex={displayIndex}
          isDragging={isDragging}
          showMaxTrack={showMaxTrack}
          exitingMaxPhase={exitingMaxPhase}
          maxTimeline={maxTimeline}
          thumbRatio={thumbRatio}
          onMaxTimelineComplete={completeMaxTimeline}
          thumbPercent={thumbPercent}
          tooltipLeftPercent={tooltipLeftPercent}
          tooltipLabel={tooltipLabel}
          trackWidthPx={trackWidthPx}
          positionTransitionsReady={positionTransitionsReady}
          maxContextAvailable={capabilityReady && maxContextAvailable}
          maxContextStatusLabel={maxContextStatusLabel}
          fastModelAvailable={capabilityReady && fastAvailable}
          fastModelStatusLabel={fastModelStatusLabel}
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
