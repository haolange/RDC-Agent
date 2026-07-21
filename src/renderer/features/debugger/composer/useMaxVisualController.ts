import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReasoningSelection } from '@shared/types/modelCapability';
import {
  createActiveMaxTimeline,
  createIdleMaxTimeline,
  createReopenMaxTimeline,
  createMaxTimeline,
  isMaxTierLevel,
  MAX_VISUAL_EGRESS_MS,
  type MaxVisualPhase,
  type MaxVisualTimeline,
  prefersReducedMotion,
  resolveMaxVisualFrame,
  shouldStartMaxDragIngress,
} from './maxVisual';

function visualNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

/** hold = freeze Max rail one frame; settle = ease ordinary fill in (CSS needs both). */
export type ExitingMaxPhase = 'off' | 'hold' | 'settle';

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
  const exitingMaxTimerRef = useRef<number | null>(null);
  const exitingMaxRafRef = useRef<number | null>(null);
  const isDraggingRef = useRef(input.isDragging);
  /** Solid-fill CSS handoff only after a settled/near-full Max — not brief ingress skims. */
  const solidHandoffEligibleRef = useRef(false);
  isDraggingRef.current = input.isDragging;

  const commitTimeline = useCallback((timeline: MaxVisualTimeline) => {
    timelineRef.current = timeline;
    setMaxTimeline(timeline);
  }, []);

  const nextRevision = useCallback(() => {
    revisionRef.current += 1;
    return revisionRef.current;
  }, []);

  const clearExitingMax = useCallback(() => {
    if (exitingMaxTimerRef.current !== null) {
      window.clearTimeout(exitingMaxTimerRef.current);
      exitingMaxTimerRef.current = null;
    }
    if (exitingMaxRafRef.current !== null) {
      window.cancelAnimationFrame(exitingMaxRafRef.current);
      exitingMaxRafRef.current = null;
    }
    setExitingMaxPhase('off');
  }, []);

  const beginExitingMax = useCallback(() => {
    if (exitingMaxTimerRef.current !== null) {
      window.clearTimeout(exitingMaxTimerRef.current);
      exitingMaxTimerRef.current = null;
    }
    if (exitingMaxRafRef.current !== null) {
      window.cancelAnimationFrame(exitingMaxRafRef.current);
      exitingMaxRafRef.current = null;
    }
    // Rapid drag / brief Max skim: skip hold+settle so ordinary fill stays snappy.
    if (isDraggingRef.current || !solidHandoffEligibleRef.current) {
      solidHandoffEligibleRef.current = false;
      setExitingMaxPhase('off');
      return;
    }
    solidHandoffEligibleRef.current = false;
    // Frame 1: keep Max rail color with transition disabled (browser won't ease otherwise).
    setExitingMaxPhase('hold');
    exitingMaxRafRef.current = window.requestAnimationFrame(() => {
      exitingMaxRafRef.current = window.requestAnimationFrame(() => {
        exitingMaxRafRef.current = null;
        // If the user already raced back into Max/drag, abort the CSS handoff.
        if (isDraggingRef.current || timelineRef.current.phase !== 'idle') {
          setExitingMaxPhase('off');
          return;
        }
        // Frame 2: enable transition and switch to ordinary fill.
        setExitingMaxPhase('settle');
        exitingMaxTimerRef.current = window.setTimeout(() => {
          exitingMaxTimerRef.current = null;
          setExitingMaxPhase('off');
        }, MAX_VISUAL_EGRESS_MS);
      });
    });
  }, []);

  const resetState = useCallback(() => {
    clearExitingMax();
    commitTimeline(createIdleMaxTimeline(nextRevision(), visualNow()));
  }, [clearExitingMax, commitTimeline, nextRevision]);

  useEffect(() => () => {
    if (exitingMaxTimerRef.current !== null) {
      window.clearTimeout(exitingMaxTimerRef.current);
    }
    if (exitingMaxRafRef.current !== null) {
      window.cancelAnimationFrame(exitingMaxRafRef.current);
    }
  }, []);

  const currentFrame = useCallback((now: number) => (
    resolveMaxVisualFrame(timelineRef.current, now, prefersReducedMotion())
  ), []);

  const startIngress = useCallback((phase: Extract<MaxVisualPhase,
    'ingress-drag' | 'ingress-committed' | 'ingress-reopen'>) => {
    const now = visualNow();
    clearExitingMax();
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
  }, [clearExitingMax, commitTimeline, currentFrame, nextRevision, resetState]);

  const startEgress = useCallback(() => {
    const now = visualNow();
    const current = timelineRef.current;
    const frame = currentFrame(now);
    if (frame.energy <= 0 || prefersReducedMotion()) {
      solidHandoffEligibleRef.current = false;
      resetState();
      return;
    }
    // Only a settled / nearly-full Max earns the post-egress solid ease-in.
    solidHandoffEligibleRef.current = current.phase === 'active' || frame.energy >= 0.85;
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
      // Re-entering Max cancels any leave-Max CSS handoff; do not clear while
      // dragging on ordinary tiers or the settle never gets to paint.
      clearExitingMax();
      // Ordinary-tier entry starts fully visible; a return from egress freezes the
      // current stop opacity. Merely pressing an already-active Max must not reveal stops.
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
