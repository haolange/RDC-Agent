import type { MaxVisualTimeline } from './maxVisual';
import { MAX_VISUAL_EGRESS_MS } from './maxVisual';

/** hold = freeze Max rail one frame; settle = ease ordinary fill in (CSS needs both). */
export type ExitingMaxPhase = 'off' | 'hold' | 'settle';

export function createMaxVisualExitController(input: {
  isDraggingRef: { current: boolean };
  solidHandoffEligibleRef: { current: boolean };
  timelineRef: { current: MaxVisualTimeline };
  setExitingMaxPhase: (phase: ExitingMaxPhase) => void;
}) {
  let exitingMaxTimer: number | null = null;
  let exitingMaxRaf: number | null = null;

  const clearExitingMax = () => {
    if (exitingMaxTimer !== null) {
      window.clearTimeout(exitingMaxTimer);
      exitingMaxTimer = null;
    }
    if (exitingMaxRaf !== null) {
      window.cancelAnimationFrame(exitingMaxRaf);
      exitingMaxRaf = null;
    }
    input.setExitingMaxPhase('off');
  };

  const beginExitingMax = () => {
    if (exitingMaxTimer !== null) {
      window.clearTimeout(exitingMaxTimer);
      exitingMaxTimer = null;
    }
    if (exitingMaxRaf !== null) {
      window.cancelAnimationFrame(exitingMaxRaf);
      exitingMaxRaf = null;
    }
    // Rapid drag / brief Max skim: skip hold+settle so ordinary fill stays snappy.
    if (input.isDraggingRef.current || !input.solidHandoffEligibleRef.current) {
      input.solidHandoffEligibleRef.current = false;
      input.setExitingMaxPhase('off');
      return;
    }
    input.solidHandoffEligibleRef.current = false;
    // Frame 1: keep Max rail color with transition disabled (browser won't ease otherwise).
    input.setExitingMaxPhase('hold');
    exitingMaxRaf = window.requestAnimationFrame(() => {
      exitingMaxRaf = window.requestAnimationFrame(() => {
        exitingMaxRaf = null;
        // If the user already raced back into Max/drag, abort the CSS handoff.
        if (input.isDraggingRef.current || input.timelineRef.current.phase !== 'idle') {
          input.setExitingMaxPhase('off');
          return;
        }
        // Frame 2: enable transition and switch to ordinary fill.
        input.setExitingMaxPhase('settle');
        exitingMaxTimer = window.setTimeout(() => {
          exitingMaxTimer = null;
          input.setExitingMaxPhase('off');
        }, MAX_VISUAL_EGRESS_MS);
      });
    });
  };

  const dispose = () => {
    if (exitingMaxTimer !== null) {
      window.clearTimeout(exitingMaxTimer);
    }
    if (exitingMaxRaf !== null) {
      window.cancelAnimationFrame(exitingMaxRaf);
    }
  };

  return { clearExitingMax, beginExitingMax, dispose };
}
