import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ReasoningSelection } from '@shared/types/modelCapability';
import type { SessionRecord } from '@shared/types/session';
import { useI18n } from '../../i18n';
import {
  hasSelectableFastMode,
  hasSelectableMaxContext,
  isFastModeUnverified,
  isMaxContextUnverified,
} from '../../lib/turnControlsUtils';
import { capabilityStatusPresentation } from './capabilityPresentation';
import {
  buildDisplaySelections,
  clampSliderRatio,
  EFFORT_LABEL_KEYS,
  getStopPosition,
  resolveNearestSnapLevel,
  resolveSelectedLevel,
} from './effortControlParts';
import { buildEffortCapabilityStatusLabels } from './effortControlStatusLabels';
import { clampCenteredTooltipPercent, EFFORT_THUMB_WIDTH_PX, thumbInsetPercent } from './effortSliderGeometry';
import { createEffortSliderHandlers } from './effortSliderHandlers';
import { useEffortPopupLayout } from './useEffortPopupLayout';
import { useMaxVisualController } from './useMaxVisualController';
import { useTurnControls } from './useTurnControls';

export function useComposerEffortControl(options: {
  agentId: string;
  currentSession: SessionRecord | null;
  open: boolean;
  disabled: boolean;
  menuRef: RefObject<HTMLDivElement | null>;
  popupRef: RefObject<HTMLDivElement | null>;
}) {
  const { agentId, currentSession, open, disabled, menuRef, popupRef } = options;
  const { t } = useI18n();
  const { turnControls, capability, capabilityState, retryCapability, updateTurnControls } = useTurnControls(agentId, currentSession);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const [snapLevel, setSnapLevel] = useState<ReasoningSelection | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragActiveRef = useRef(false);
  const suppressClickRef = useRef(false);
  const pointerFrameRef = useRef(0);
  const pendingDragRatioRef = useRef<number | null>(null);
  const isDragging = dragRatio !== null;
  const reasoningControl = capability?.controls.reasoning ?? null;
  const capabilityReady = capabilityState.status === 'ready' || capabilityState.status === 'refreshing';
  const capabilityKey = capability ? `${capability.providerId}:${capability.modelId}` : 'pending';
  const displayLevels = useMemo(() => buildDisplaySelections(reasoningControl), [reasoningControl]);
  const displayLevelsKey = displayLevels.join('|');
  const reasoningLockedDisabled = !reasoningControl || reasoningControl.kind === 'unknown' || reasoningControl.kind === 'none';
  const hasAdjustableReasoning = !disabled && !reasoningLockedDisabled && displayLevels.length > 1 && reasoningControl?.kind !== 'always-on';
  const selectedLevel = resolveSelectedLevel(turnControls.reasoningLevel, reasoningControl, displayLevels);

  useEffect(() => {
    if (snapLevel !== null && selectedLevel === snapLevel) setSnapLevel(null);
  }, [selectedLevel, snapLevel]);

  const validSnapLevel = snapLevel && displayLevels.includes(snapLevel) ? snapLevel : null;
  const displayLevel = isDragging ? resolveNearestSnapLevel(dragRatio, displayLevels) : (validSnapLevel ?? selectedLevel);
  const displayIndex = Math.max(0, displayLevels.indexOf(displayLevel));
  const thumbRatio = isDragging ? clampSliderRatio(dragRatio) : getStopPosition(displayIndex, displayLevels.length);
  const {
    showMaxTrack,
    exitingMaxPhase,
    maxTimeline,
    resetMaxVisual,
    applyCommittedLevelVisual,
    completeMaxTimeline,
  } = useMaxVisualController({ open, isDragging, displayLevel, selectedLevel });

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

  const effortLabel = t(reasoningLockedDisabled ? 'composer.effort.levelOff' : EFFORT_LABEL_KEYS[selectedLevel]);
  const tooltipLabel = t(reasoningLockedDisabled ? 'composer.effort.levelOff' : EFFORT_LABEL_KEYS[displayLevel]);
  const statusPresentation = capabilityStatusPresentation(capabilityState);
  const capabilityStateLabel = statusPresentation.labelKey ? t(statusPresentation.labelKey) : undefined;
  const capabilityStateDetail = statusPresentation.detailKey ? t(statusPresentation.detailKey) : undefined;
  const { maxContextStatusLabel, fastModelStatusLabel } = buildEffortCapabilityStatusLabels({
    capability,
    capabilityReady,
    capabilityStateLabel,
    maxTierUnverified: isMaxContextUnverified(capability),
    fastUnverified: isFastModeUnverified(capability),
    t,
  });
  const trackObserveKey = [
    capabilityStateLabel ?? '',
    reasoningLockedDisabled ? '1' : '0',
    hasAdjustableReasoning ? '1' : '0',
    displayLevelsKey,
  ].join('|');
  const layout = useEffortPopupLayout({ open, menuRef, popupRef, trackRef, trackObserveKey });
  const thumbPercent = thumbInsetPercent(thumbRatio, layout.trackWidthPx, EFFORT_THUMB_WIDTH_PX);
  const tooltipLeftPercent = clampCenteredTooltipPercent(
    thumbPercent,
    layout.trackWidthPx,
    Math.max(96, Math.ceil(tooltipLabel.length * 8 + 24)),
  );

  const commitEffort = useCallback((level: ReasoningSelection) => {
    if (!displayLevels.includes(level)) return;
    setSnapLevel(level);
    updateTurnControls({ reasoningLevel: level });
    applyCommittedLevelVisual(level);
  }, [applyCommittedLevelVisual, displayLevels, updateTurnControls]);

  return {
    turnControls,
    selectedLevel,
    effortLabel,
    displayLevel,
    displayLevels,
    displayIndex,
    hasAdjustableReasoning,
    isDragging,
    showMaxTrack,
    exitingMaxPhase,
    maxTimeline,
    thumbRatio,
    thumbPercent,
    tooltipLeftPercent,
    tooltipLabel,
    trackWidthPx: layout.trackWidthPx,
    positionTransitionsReady: layout.positionTransitionsReady,
    popupShift: layout.popupShift,
    trackRef,
    capabilityStateDetail,
    capabilityRefreshing: statusPresentation.refreshing,
    capabilityRetryLabel: t('composer.effort.capabilityRetry'),
    retryCapability,
    maxContextAvailable: capabilityReady && !disabled && hasSelectableMaxContext(capability),
    maxContextStatusLabel,
    fastAvailable: capabilityReady && !disabled && hasSelectableFastMode(capability),
    fastModelStatusLabel,
    completeMaxTimeline,
    sliderHandlers: createEffortSliderHandlers({
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
    }),
    toggleMaxContext: () => updateTurnControls({ maxContextMode: !turnControls.maxContextMode }),
    toggleFastModel: () => updateTurnControls({ fastModel: !turnControls.fastModel }),
  };
}
