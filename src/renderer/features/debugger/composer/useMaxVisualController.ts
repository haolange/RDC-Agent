import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReasoningSelection } from '@shared/types/modelCapability';
import {
  isMaxTierLevel,
  MAX_VISUAL_EVOLVE_MS,
  MAX_VISUAL_RETREAT_MS,
  type MaxVisualPhase,
  prefersReducedMotion,
  resolveMaxAnimationProgress,
  resolveMaxStopsOpacity,
} from './maxVisual';

export function useMaxVisualController(input: {
  open: boolean;
  isDragging: boolean;
  displayLevel: ReasoningSelection;
  selectedLevel: ReasoningSelection;
}) {
  const [maxPhase, setMaxPhaseState] = useState<MaxVisualPhase>('idle');
  const [maxProgress, setMaxProgressState] = useState(0);
  const [evolveHideStops, setEvolveHideStopsState] = useState(false);
  const [retreatStopsFrom, setRetreatStopsFrom] = useState(0);
  const maxPhaseRef = useRef<MaxVisualPhase>('idle');
  const maxProgressRef = useRef(0);
  const evolveHideStopsRef = useRef(false);
  const animFrameRef = useRef(0);
  const wasMaxWhileDraggingRef = useRef(false);
  const prevOpenRef = useRef(false);

  const cancelAnimation = useCallback(() => {
    if (!animFrameRef.current) return;
    window.cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = 0;
  }, []);

  const setPhase = useCallback((phase: MaxVisualPhase) => {
    maxPhaseRef.current = phase;
    setMaxPhaseState(phase);
  }, []);

  const setProgress = useCallback((progress: number) => {
    maxProgressRef.current = progress;
    setMaxProgressState(progress);
  }, []);

  const setHideStops = useCallback((hide: boolean) => {
    evolveHideStopsRef.current = hide;
    setEvolveHideStopsState(hide);
  }, []);

  const runAnimation = useCallback((
    phase: 'evolve' | 'retreat',
    durationMs: number,
    onComplete: () => void,
  ) => {
    cancelAnimation();
    setPhase(phase);
    setProgress(0);
    const startedAt = performance.now();
    const tick = (now: number) => {
      const next = resolveMaxAnimationProgress(now - startedAt, durationMs);
      setProgress(next);
      if (next < 1) {
        animFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }
      animFrameRef.current = 0;
      onComplete();
    };
    animFrameRef.current = window.requestAnimationFrame(tick);
  }, [cancelAnimation, setPhase, setProgress]);

  const resetState = useCallback(() => {
    cancelAnimation();
    setHideStops(false);
    setPhase('idle');
    setProgress(0);
    setRetreatStopsFrom(0);
    wasMaxWhileDraggingRef.current = false;
  }, [cancelAnimation, setHideStops, setPhase, setProgress]);

  const startEvolve = useCallback((hideStops: boolean) => {
    setHideStops(hideStops);
    if (prefersReducedMotion()) {
      cancelAnimation();
      setPhase('settled');
      setProgress(1);
      return;
    }
    runAnimation('evolve', MAX_VISUAL_EVOLVE_MS, () => {
      setPhase('settled');
      setProgress(1);
    });
  }, [cancelAnimation, runAnimation, setHideStops, setPhase, setProgress]);

  const startRetreat = useCallback(() => {
    if (maxPhaseRef.current === 'retreat' && animFrameRef.current) return;
    const stopsFrom = resolveMaxStopsOpacity({
      phase: maxPhaseRef.current,
      progress: maxProgressRef.current,
      evolveHideStops: evolveHideStopsRef.current,
    });
    setRetreatStopsFrom(stopsFrom);
    setHideStops(false);
    if (prefersReducedMotion()) {
      resetState();
      return;
    }
    runAnimation('retreat', MAX_VISUAL_RETREAT_MS, resetState);
  }, [resetState, runAnimation, setHideStops]);

  const enterPreview = useCallback(() => {
    cancelAnimation();
    setHideStops(false);
    setPhase('preview');
    setProgress(0);
  }, [cancelAnimation, setHideStops, setPhase, setProgress]);

  useEffect(() => () => cancelAnimation(), [cancelAnimation]);

  useEffect(() => {
    const justOpened = input.open && !prevOpenRef.current;
    const justClosed = !input.open && prevOpenRef.current;
    prevOpenRef.current = input.open;
    if (justClosed) {
      resetState();
      return;
    }
    if (!justOpened) return;
    if (isMaxTierLevel(input.selectedLevel)) startEvolve(true);
    else resetState();
  }, [input.open, input.selectedLevel, resetState, startEvolve]);

  const isMaxTier = isMaxTierLevel(input.displayLevel);

  useEffect(() => {
    if (!input.open || !input.isDragging) return;
    if (isMaxTier) {
      wasMaxWhileDraggingRef.current = true;
      if (maxPhaseRef.current !== 'preview') enterPreview();
      return;
    }
    const shouldRetreat = wasMaxWhileDraggingRef.current
      || ['preview', 'settled', 'evolve'].includes(maxPhaseRef.current);
    wasMaxWhileDraggingRef.current = false;
    if (shouldRetreat && maxPhaseRef.current !== 'retreat' && maxPhaseRef.current !== 'idle') {
      startRetreat();
    }
  }, [input.open, input.isDragging, isMaxTier, enterPreview, startRetreat]);

  const applyCommittedLevelVisual = useCallback((level: ReasoningSelection) => {
    wasMaxWhileDraggingRef.current = false;
    if (isMaxTierLevel(level)) {
      startEvolve(false);
      return;
    }
    if (maxPhaseRef.current !== 'idle' && maxPhaseRef.current !== 'retreat') startRetreat();
  }, [startEvolve, startRetreat]);

  const stopsOpacity = resolveMaxStopsOpacity({
    phase: maxPhase,
    progress: maxProgress,
    evolveHideStops,
    retreatStopsFrom,
  });

  return {
    maxPhase,
    maxProgress,
    stopsOpacity,
    showMaxTrack: maxPhase !== 'idle',
    isMaxTier,
    resetMaxVisual: resetState,
    applyCommittedLevelVisual,
  };
}
