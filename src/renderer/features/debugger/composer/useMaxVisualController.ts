import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReasoningSelection } from '@shared/types/modelCapability';
import {
  createActiveMaxTimeline,
  createIdleMaxTimeline,
  createReopenMaxTimeline,
  createMaxTimeline,
  isMaxTierLevel,
  type MaxVisualPhase,
  type MaxVisualTimeline,
  prefersReducedMotion,
  resolveMaxVisualFrame,
  shouldStartMaxDragIngress,
} from './maxVisual';

function visualNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

export function useMaxVisualController(input: {
  open: boolean;
  isDragging: boolean;
  displayLevel: ReasoningSelection;
  selectedLevel: ReasoningSelection;
}) {
  const initialTimeline = useRef(createIdleMaxTimeline(0, visualNow()));
  const [maxTimeline, setMaxTimeline] = useState<MaxVisualTimeline>(initialTimeline.current);
  const timelineRef = useRef(initialTimeline.current);
  const revisionRef = useRef(0);
  const prevOpenRef = useRef(false);

  const commitTimeline = useCallback((timeline: MaxVisualTimeline) => {
    timelineRef.current = timeline;
    setMaxTimeline(timeline);
  }, []);

  const nextRevision = useCallback(() => {
    revisionRef.current += 1;
    return revisionRef.current;
  }, []);

  const resetState = useCallback(() => {
    commitTimeline(createIdleMaxTimeline(nextRevision(), visualNow()));
  }, [commitTimeline, nextRevision]);

  const currentFrame = useCallback((now: number) => (
    resolveMaxVisualFrame(timelineRef.current, now, prefersReducedMotion())
  ), []);

  const startIngress = useCallback((phase: Extract<MaxVisualPhase,
    'ingress-drag' | 'ingress-committed' | 'ingress-reopen'>) => {
    const now = visualNow();
    if (document.hidden) {
      resetState();
      return;
    }
    const current = timelineRef.current;
    const fieldEpoch = phase === 'ingress-reopen' || current.phase === 'idle'
      ? now
      : current.fieldEpoch;
    if (prefersReducedMotion() && phase !== 'ingress-drag') {
      commitTimeline(createActiveMaxTimeline(nextRevision(), now, fieldEpoch));
      return;
    }
    if (phase === 'ingress-reopen') {
      commitTimeline(createReopenMaxTimeline(nextRevision(), now));
      return;
    }
    const frame = currentFrame(now);
    commitTimeline(createMaxTimeline({
      phase,
      revision: nextRevision(),
      now,
      fromEnergy: frame.energy,
      formationEnergy: current.phase === 'egress' ? current.formationEnergy : frame.energy,
      fieldMode: current.phase === 'egress' ? 'dissolve' : 'propagate',
      fromStopsOpacity: frame.stopsOpacity,
      fieldEpoch,
    }));
  }, [commitTimeline, currentFrame, nextRevision, resetState]);

  const startEgress = useCallback(() => {
    const now = visualNow();
    const current = timelineRef.current;
    const frame = currentFrame(now);
    if (frame.energy <= 0 || prefersReducedMotion()) {
      resetState();
      return;
    }
    commitTimeline(createMaxTimeline({
      phase: 'egress',
      revision: nextRevision(),
      now,
      fromEnergy: frame.energy,
      formationEnergy: current.phase === 'egress' ? current.formationEnergy : frame.energy,
      fieldMode: 'dissolve',
      fromStopsOpacity: frame.stopsOpacity,
      fieldEpoch: current.fieldEpoch,
    }));
  }, [commitTimeline, currentFrame, nextRevision, resetState]);

  const completeTimeline = useCallback((revision: number) => {
    const current = timelineRef.current;
    if (current.revision !== revision) return;
    const now = visualNow();
    if (current.phase === 'ingress-committed' || current.phase === 'ingress-reopen') {
      commitTimeline(createActiveMaxTimeline(nextRevision(), now, current.fieldEpoch));
    } else if (current.phase === 'egress') {
      commitTimeline(createIdleMaxTimeline(nextRevision(), now));
    }
  }, [commitTimeline, nextRevision]);

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
      // Ordinary-tier entry starts fully visible; a return from egress freezes the
      // current stop opacity. Merely pressing an already-active Max must not reveal stops.
      if (shouldStartMaxDragIngress(currentPhase)) {
        startIngress('ingress-drag');
      }
      return;
    }
    if (currentPhase !== 'idle' && currentPhase !== 'egress') startEgress();
  }, [input.isDragging, input.open, isMaxTier, startEgress, startIngress]);

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
    isMaxTier,
    resetMaxVisual: resetState,
    applyCommittedLevelVisual,
    completeMaxTimeline: completeTimeline,
  };
}
