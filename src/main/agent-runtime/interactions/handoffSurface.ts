import type { AgentHandoffDefinition, HandoffSurface } from '@shared/types/agentManifest';

/** Where a declared handoff is offered; a handoff without a surface is offered at turn end. */
export function handoffSurfaceOf(handoff: Pick<AgentHandoffDefinition, 'surface'>): HandoffSurface {
  return handoff.surface ?? 'turn-end';
}

export function isHandoffOfferedAtTurnEnd(handoff: Pick<AgentHandoffDefinition, 'surface'>): boolean {
  return handoffSurfaceOf(handoff) === 'turn-end';
}

/** A handoff the user can take as a continue action: every surface except `hidden`. */
export function isHandoffContinueAction(handoff: Pick<AgentHandoffDefinition, 'surface'>): boolean {
  return handoff.surface !== 'hidden';
}
