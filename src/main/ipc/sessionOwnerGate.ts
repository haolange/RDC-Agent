import type { WorkbenchIpcState } from './workbenchContext';

/** Mutation channels may touch only the session the workbench currently owns. */
export function requireActiveSessionOwner(
  state: Pick<WorkbenchIpcState, 'currentSessionId'>,
  sessionId: string | null | undefined,
): string {
  if (!state.currentSessionId || !sessionId || sessionId !== state.currentSessionId) {
    throw new Error('SESSION_OWNER_DENIED');
  }
  return state.currentSessionId;
}
