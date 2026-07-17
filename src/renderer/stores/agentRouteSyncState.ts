import type { LlmAgentRoute } from '@shared/types/settings';

export type AgentRouteSyncState =
  | { status: 'saving'; clientRevision: number; commitHash: string | null }
  | { status: 'committed'; clientRevision: number; commitHash: string | null }
  | { status: 'failed'; clientRevision: number; commitHash: string | null; error: string };

export function routeMutationAffectsCapability(
  previousState: AgentRouteSyncState | undefined,
  previousRoute: LlmAgentRoute | null,
  nextRoute: LlmAgentRoute | null,
): boolean {
  return previousState?.status === 'saving'
    || previousRoute?.providerId !== nextRoute?.providerId
    || previousRoute?.modelId !== nextRoute?.modelId;
}

export function withAgentRouteSyncState(
  states: Record<string, AgentRouteSyncState>,
  agentId: string,
  tracked: boolean,
  next: AgentRouteSyncState,
): Record<string, AgentRouteSyncState> {
  return tracked ? { ...states, [agentId]: next } : states;
}
