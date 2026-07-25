import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReasoningSelection } from '@shared/types/modelCapability';
import {
  isMaxTierLevel,
  type MaxVisualPhase,
  type MaxVisualTimeline,
  shouldStartMaxDragIngress,
} from './maxVisual';
import {
  createMaxVisualExitController,
  type ExitingMaxPhase,
} from './maxVisualExitController';
import {
  buildEgressTimeline,
  buildIngressTimeline,
  createActiveMaxTimeline,
  createIdleMaxTimeline,
  visualNow,
} from './maxVisualTimelineActions';

export type { ExitingMaxPhase } from './maxVisualExitController';

export function useMaxVisualController(input: {
  open: boolean;
  isDragging: boolean;
  displayLevel: ReasoningSelection;
  selectedLevel: ReasoningSelection;
}) {
  const initialTimeline = useRef(createIdleMaxTimeline(0, visualNow()));
  const [maxTimeline, setMaxTimeline] = useState<MaxVisualTimeline>(initialTimeline.current);
  const [exitingMaxPhase, setExitingMaxPhase] = useState<ExitingMaxPhase>('off');
  const timelineRef = useRef(initialTimeline.current);
  const revisionRef = useRef(0);
  const prevOpenRef = useRef(false);
  const isDraggingRef = useRef(input.isDragging);
  /** Solid-fill CSS handoff only after a settled/near-full Max — not brief ingress skims. */
  const solidHandoffEligibleRef = useRef(false);
  isDraggingRef.current = input.isDragging;

  const exitController = useMemo(
    () => createMaxVisualExitController({
      isDraggingRef,
      solidHandoffEligibleRef,
      timelineRef,
      setExitingMaxPhase,
    }),
    [],
  );

  const commitTimeline = useCallback((timeline: MaxVisualTimeline) => {
    timelineRef.current = timeline;
    setMaxTimeline(timeline);
  }, []);

  const nextRevision = useCallback(() => {
    revisionRef.current += 1;
    return revisionRef.current;
  }, []);

  const clearExitingMax = exitController.clearExitingMax;
  const beginExitingMax = exitController.beginExitingMax;

  const resetState = useCallback(() => {
    clearExitingMax();
    commitTimeline(createIdleMaxTimeline(nextRevision(), visualNow()));
  }, [clearExitingMax, commitTimeline, nextRevision]);

  useEffect(() => () => {
    exitController.dispose();
  }, [exitController]);

  const startIngress = useCallback((phase: Extract<MaxVisualPhase,
    'ingress-drag' | 'ingress-committed' | 'ingress-reopen'>) => {
    clearExitingMax();
    const built = buildIngressTimeline({
      phase,
      current: timelineRef.current,
      nextRevision,
    });
    if (built === 'reset') {
      resetState();
      return;
    }
    commitTimeline(built);
  }, [clearExitingMax, commitTimeline, nextRevision, resetState]);

  const startEgress = useCallback(() => {
    const built = buildEgressTimeline({
      current: timelineRef.current,
      nextRevision,
    });
    if (built === 'reset') {
      solidHandoffEligibleRef.current = false;
      resetState();
      return;
    }
    solidHandoffEligibleRef.current = built.solidHandoffEligible;
    commitTimeline(built.timeline);
  }, [commitTimeline, nextRevision, resetState]);

  const completeTimeline = useCallback((revision: number) => {
    const current = timelineRef.current;
    if (current.revision !== revision) return;
    const now = visualNow();
    if (current.phase === 'ingress-committed' || current.phase === 'ingress-reopen') {
      commitTimeline(createActiveMaxTimeline(nextRevision(), now, current.fieldEpoch));
    } else if (current.phase === 'egress') {
      commitTimeline(createIdleMaxTimeline(nextRevision(), now));
      beginExitingMax();
    }
  }, [beginExitingMax, commitTimeline, nextRevision]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        resetState();
      } else if (input.open && isMaxTierLevel(input.selectedLevel)) {
        startIngress('ingress-reopen');
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [input.open, input.selectedLevel, resetState, startIngress]);

  useLayoutEffect(() => {
    const justOpened = input.open && !prevOpenRef.current;
    const justClosed = !input.open && prevOpenRef.current;
    prevOpenRef.current = input.open;
    if (justClosed) {
      resetState();
      return;
    }
    if (!justOpened) return;
    if (isMaxTierLevel(input.selectedLevel)) startIngress('ingress-reopen');
    else resetState();
  }, [input.open, input.selectedLevel, resetState, startIngress]);

  const isMaxTier = isMaxTierLevel(input.displayLevel);
  useLayoutEffect(() => {
    if (!input.open || !input.isDragging) return;
    const currentPhase = timelineRef.current.phase;
    if (isMaxTier) {
      clearExitingMax();
      if (shouldStartMaxDragIngress(currentPhase)) {
        startIngress('ingress-drag');
      }
      return;
    }
    if (currentPhase !== 'idle' && currentPhase !== 'egress') startEgress();
  }, [clearExitingMax, input.isDragging, input.open, isMaxTier, startEgress, startIngress]);

  const applyCommittedLevelVisual = useCallback((level: ReasoningSelection) => {
    if (isMaxTierLevel(level)) {
      startIngress('ingress-committed');
      return;
    }
    const phase = timelineRef.current.phase;
    if (phase !== 'idle' && phase !== 'egress') startEgress();
  }, [startEgress, startIngress]);

  return {
    maxTimeline,
    showMaxTrack: maxTimeline.phase !== 'idle',
    exitingMaxPhase,
    isMaxTier,
    resetMaxVisual: resetState,
    applyCommittedLevelVisual,
    completeMaxTimeline: completeTimeline,
  };
}
