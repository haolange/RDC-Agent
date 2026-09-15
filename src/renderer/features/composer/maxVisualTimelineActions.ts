import type { MaxVisualTimeline, MaxVisualPhase } from './maxVisual';
import {
  createActiveMaxTimeline,
  createIdleMaxTimeline,
  createReopenMaxTimeline,
  createMaxTimeline,
  resolveMaxVisualFrame,
} from './maxVisual';

function visualNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

export function buildIngressTimeline(input: {
  phase: Extract<MaxVisualPhase, 'ingress-drag' | 'ingress-committed' | 'ingress-reopen'>;
  current: MaxVisualTimeline;
  nextRevision: () => number;
}): MaxVisualTimeline | 'reset' {
  const now = visualNow();
  if (document.hidden) return 'reset';
  const { phase, current, nextRevision } = input;
  const fieldEpoch = phase === 'ingress-reopen' || current.phase === 'idle'
    ? now
    : current.fieldEpoch;
  if (phase === 'ingress-reopen') {
    return createReopenMaxTimeline(nextRevision(), now);
  }
  const frame = resolveMaxVisualFrame(current, now);
  return createMaxTimeline({
    phase,
    revision: nextRevision(),
    now,
    fromEnergy: frame.energy,
    formationEnergy: current.phase === 'egress' ? current.formationEnergy : frame.energy,
    fieldMode: current.phase === 'egress' ? 'dissolve' : 'propagate',
    fromStopsOpacity: frame.stopsOpacity,
    fieldEpoch,
  });
}

export function buildEgressTimeline(input: {
  current: MaxVisualTimeline;
  nextRevision: () => number;
}): { timeline: MaxVisualTimeline; solidHandoffEligible: boolean } | 'reset' {
  const now = visualNow();
  const { current, nextRevision } = input;
  const frame = resolveMaxVisualFrame(current, now);
  if (frame.energy <= 0) {
    return 'reset';
  }
  return {
    solidHandoffEligible: current.phase === 'active' || frame.energy >= 0.85,
    timeline: createMaxTimeline({
      phase: 'egress',
      revision: nextRevision(),
      now,
      fromEnergy: frame.energy,
      formationEnergy: current.phase === 'egress' ? current.formationEnergy : frame.energy,
      fieldMode: 'dissolve',
      fromStopsOpacity: frame.stopsOpacity,
      fieldEpoch: current.fieldEpoch,
    }),
  };
}

export { createActiveMaxTimeline, createIdleMaxTimeline, visualNow };
