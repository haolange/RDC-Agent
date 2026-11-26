export interface HandoffSendPayload {
  sessionId: string;
  agentId: string;
  prompt: string;
  planReference?: import('@shared/types/planReview').PlanReferenceRequest;
}
export interface ComposerSendOutcome {
  status: 'accepted' | 'rejected' | 'cancelled' | 'unknown';
  requestId: string;
  error?: string;
}

/** Absence from history does not prove that a dispatched request was rejected. */
export async function inspectHandoffCommit(
  api: NonNullable<Window['electronAPI']>['conversation'],
  sessionId: string,
  requestId: string,
): Promise<ComposerSendOutcome> {
  try {
    const history = await api.getHistory(sessionId);
    if (history.messages.some((message) => message.role === 'user' && message.requestId === requestId)) {
      return { status: 'accepted', requestId };
    }
  } catch {
    /* Remain uncertain; a failed read is never permission to resend. */
  }
  return { status: 'unknown', requestId, error: 'HANDOFF_DELIVERY_UNCONFIRMED' };
}

/** Whether main committed a handoff send, read from the app bridge. */
export function inspectHandoffRequest(sessionId: string, requestId: string): Promise<ComposerSendOutcome> {
  return inspectHandoffCommit(window.electronAPI.conversation, sessionId, requestId);
}
