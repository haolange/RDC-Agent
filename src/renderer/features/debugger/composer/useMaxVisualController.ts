import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReasoningSelection } from '@shared/types/modelCapability';
import {
  isMaxTierLevel,
  MAX_VISUAL_EVOLVE_MS,
  MAX_VISUAL_RETREAT_MS,
  type MaxVisualPhase,
  prefersReducedMotion,
} from './maxVisual';

export function useMaxVisualController(input: {
  open: boolean;
  isDragging: boolean;
  displayLevel: ReasoningSelection;
  selectedLevel: ReasoningSelection;
}) {
  const [maxPhase, setMaxPhase] = useState<MaxVisualPhase>('idle');
  const phaseRef = useRef<MaxVisualPhase>('idle');
  const timerRef = useRef<number | null>(null);
  const wasMaxWhileDraggingRef = useRef(false);
  const prevOpenRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const commitPhase = useCallback((phase: MaxVisualPhase) => {
    phaseRef.current = phase;
    setMaxPhase(phase);
  }, []);

  const resetState = useCallback(() => {
    clearTimer();
    wasMaxWhileDraggingRef.current = false;
    commitPhase('idle');
  }, [clearTimer, commitPhase]);

  const startEvolve = useCallback(() => {
    clearTimer();
    if (prefersReducedMotion() || document.hidden) {
      commitPhase('settled');
      return;
    }
    commitPhase('evolve');
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      commitPhase('settled');
    }, MAX_VISUAL_EVOLVE_MS);
  }, [clearTimer, commitPhase]);

  const startRetreat = useCallback(() => {
    if (phaseRef.current === 'idle' || phaseRef.current === 'retreat') return;
    clearTimer();
    if (prefersReducedMotion() || document.hidden) {
      resetState();
      return;
    }
    commitPhase('retreat');
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      commitPhase('idle');
    }, MAX_VISUAL_RETREAT_MS);
  }, [clearTimer, commitPhase, resetState]);

  const enterPreview = useCallback(() => {
    clearTimer();
    commitPhase('preview');
  }, [clearTimer, commitPhase]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) resetState();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearTimer();
    };
  }, [clearTimer, resetState]);

  useEffect(() => {
    const justOpened = input.open && !prevOpenRef.current;
    const justClosed = !input.open && prevOpenRef.current;
    prevOpenRef.current = input.open;
    if (justClosed) {
      resetState();
      return;
    }
    if (!justOpened) return;
    if (isMaxTierLevel(input.selectedLevel)) startEvolve();
    else resetState();
  }, [input.open, input.selectedLevel, resetState, startEvolve]);

  const isMaxTier = isMaxTierLevel(input.displayLevel);
  useEffect(() => {
    if (!input.open || !input.isDragging) return;
    if (isMaxTier) {
      wasMaxWhileDraggingRef.current = true;
      if (phaseRef.current !== 'preview') enterPreview();
      return;
    }
    const shouldRetreat = wasMaxWhileDraggingRef.current
      || ['preview', 'settled', 'evolve'].includes(phaseRef.current);
    wasMaxWhileDraggingRef.current = false;
    if (shouldRetreat) startRetreat();
  }, [enterPreview, input.isDragging, input.open, isMaxTier, startRetreat]);

  const applyCommittedLevelVisual = useCallback((level: ReasoningSelection) => {
    wasMaxWhileDraggingRef.current = false;
    if (isMaxTierLevel(level)) startEvolve();
    else startRetreat();
  }, [startEvolve, startRetreat]);

  return {
    maxPhase,
    maxProgress: maxPhase === 'settled' ? 1 : 0,
    stopsOpacity: maxPhase === 'evolve' || maxPhase === 'settled' || maxPhase === 'preview' ? 0 : 1,
    showMaxTrack: maxPhase !== 'idle',
    isMaxTier,
    resetMaxVisual: resetState,
    applyCommittedLevelVisual,
  };
}
