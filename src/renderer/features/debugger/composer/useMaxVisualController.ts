import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReasoningSelection } from '@shared/types/modelCapability';
import {
  isMaxTierLevel,
  MAX_VISUAL_EVOLVE_MS,
  MAX_VISUAL_RETREAT_MS,
  type MaxVisualPhase,
  prefersReducedMotion,
  resolveMaxStopsOpacity,
} from './maxVisual';

export function useMaxVisualController(input: {
  open: boolean;
  isDragging: boolean;
  displayLevel: ReasoningSelection;
  selectedLevel: ReasoningSelection;
}) {
  const [maxPhase, setMaxPhase] = useState<MaxVisualPhase>('idle');
  const [maxProgress, setMaxProgress] = useState(0);
  const [evolveHideStops, setEvolveHideStops] = useState(false);
  const [retreatStopsFrom, setRetreatStopsFrom] = useState(0);
  const maxPhaseRef = useRef<MaxVisualPhase>('idle');
  const maxProgressRef = useRef(0);
  const evolveHideStopsRef = useRef(false);
  const animFrameRef = useRef(0);
  const wasMaxWhileDraggingRef = useRef(false);
  const prevOpenRef = useRef(false);

  maxProgressRef.current = maxProgress;
  evolveHideStopsRef.current = evolveHideStops;

  const cancelMaxAnim = useCallback(() => {
    if (animFrameRef.current) {
      window.cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
  }, []);

  const setPhase = useCallback((phase: MaxVisualPhase) => {
    maxPhaseRef.current = phase;
    setMaxPhase(phase);
  }, []);

  const startEvolve = useCallback((hideStops: boolean) => {
    cancelMaxAnim();
    setEvolveHideStops(hideStops);
    if (prefersReducedMotion()) {
      setPhase('settled');
      setMaxProgress(1);
      return;
    }
    setPhase('evolve');
    setMaxProgress(0);
    const started = performance.now();
    const tick = (now: number) => {
      const next = Math.min(1, (now - started) / MAX_VISUAL_EVOLVE_MS);
      setMaxProgress(next);
      if (next < 1) {
        animFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }
      animFrameRef.current = 0;
      setPhase('settled');
      setMaxProgress(1);
    };
    animFrameRef.current = window.requestAnimationFrame(tick);
  }, [cancelMaxAnim, setPhase]);

  const startRetreat = useCallback(() => {
    // Already retreating — do not cancel/restart (that freezes progress at 0 and looks like a fade).
    if (maxPhaseRef.current === 'retreat' && animFrameRef.current) return;
    cancelMaxAnim();
    setEvolveHideStops(false);

    // Preserve current stop visibility so leave-Max never blinks 1→0→fade.
    const prev = maxPhaseRef.current;
    let stopsFrom = 0;
    if (prev === 'preview') {
      stopsFrom = 1;
    } else if (prev === 'evolve') {
      stopsFrom = evolveHideStopsRef.current ? 0 : 1 - maxProgressRef.current;
    } else if (prev === 'settled') {
      stopsFrom = 0;
    }
    setRetreatStopsFrom(stopsFrom);

    if (prefersReducedMotion()) {
      setPhase('idle');
      setMaxProgress(0);
      return;
    }
    setPhase('retreat');
    setMaxProgress(0);
    const started = performance.now();
    const tick = (now: number) => {
      const next = Math.min(1, (now - started) / MAX_VISUAL_RETREAT_MS);
      setMaxProgress(next);
      if (next < 1) {
        animFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }
      animFrameRef.current = 0;
      setPhase('idle');
      setMaxProgress(0);
      setRetreatStopsFrom(0);
    };
    animFrameRef.current = window.requestAnimationFrame(tick);
  }, [cancelMaxAnim, setPhase]);

  const enterPreview = useCallback(() => {
    cancelMaxAnim();
    setEvolveHideStops(false);
    setPhase('preview');
    setMaxProgress(0);
  }, [cancelMaxAnim, setPhase]);

  const resetMaxVisual = useCallback(() => {
    cancelMaxAnim();
    setEvolveHideStops(false);
    setPhase('idle');
    setMaxProgress(0);
    wasMaxWhileDraggingRef.current = false;
  }, [cancelMaxAnim, setPhase]);

  useEffect(() => () => cancelMaxAnim(), [cancelMaxAnim]);

  useEffect(() => {
    const justOpened = input.open && !prevOpenRef.current;
    const justClosed = !input.open && prevOpenRef.current;
    prevOpenRef.current = input.open;

    if (justClosed) {
      cancelMaxAnim();
      setPhase('idle');
      setMaxProgress(0);
      setEvolveHideStops(false);
      wasMaxWhileDraggingRef.current = false;
      return;
    }
    if (!justOpened) return;
    if (isMaxTierLevel(input.selectedLevel)) {
      startEvolve(true);
      return;
    }
    setPhase('idle');
    setMaxProgress(0);
    setEvolveHideStops(false);
  }, [input.open, input.selectedLevel, cancelMaxAnim, setPhase, startEvolve]);

  const isMaxTier = isMaxTierLevel(input.displayLevel);

  useEffect(() => {
    if (!input.open || !input.isDragging) return;
    if (isMaxTier) {
      wasMaxWhileDraggingRef.current = true;
      if (maxPhaseRef.current !== 'preview') {
        enterPreview();
      }
      return;
    }
    if (
      wasMaxWhileDraggingRef.current
      || maxPhaseRef.current === 'preview'
      || maxPhaseRef.current === 'settled'
      || maxPhaseRef.current === 'evolve'
    ) {
      wasMaxWhileDraggingRef.current = false;
      if (maxPhaseRef.current !== 'retreat' && maxPhaseRef.current !== 'idle') {
        startRetreat();
      }
    }
  }, [input.open, input.isDragging, isMaxTier, enterPreview, startRetreat]);

  const applyCommittedLevelVisual = useCallback((level: ReasoningSelection) => {
    if (isMaxTierLevel(level)) {
      wasMaxWhileDraggingRef.current = false;
      startEvolve(false);
      return;
    }
    // Leave Max: keep an in-flight retreat; never restart it from 0 mid-way.
    if (maxPhaseRef.current === 'idle' || maxPhaseRef.current === 'retreat') return;
    wasMaxWhileDraggingRef.current = false;
    startRetreat();
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
    resetMaxVisual,
    applyCommittedLevelVisual,
  };
}
