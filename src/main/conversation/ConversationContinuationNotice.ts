import type { ConversationMessage } from '@shared/types/conversation';
import type { RequestPlan } from '@shared/types/providerCapability';
import type { PreparedTurnContextSummary } from '@shared/types/session';
import { createConversationMessage } from './ConversationRoutePreflight';

export function shouldAnnounceContinuationDrop(
  previous: PreparedTurnContextSummary | PreparedTurnContextSummary['route'] | undefined,
  next: RequestPlan,
): boolean {
  const previousRoute = previous && 'route' in previous ? previous.route : previous;
  if (!previousRoute) return false;
  return previousRoute.providerId !== next.providerId
    || previousRoute.effectiveModelId !== next.effectiveModelId
    || previousRoute.protocol !== next.route.protocol;
}

export function createContinuationDropNotice(options: {
  requestId: string;
  turnId: string;
  sessionId: string | null;
  projectId: string | null;
  runId?: string | null;
  profileId?: string;
  branchId: string;
  forkId?: string;
  variantIndex?: number;
  previous?: PreparedTurnContextSummary['route'];
  next: RequestPlan;
}): ConversationMessage {
  return createConversationMessage(
    'system',
    'Model switched. Reasoning continuation from the previous model cannot be reused.',
    {
      requestId: options.requestId,
      turnId: options.turnId,
      sessionId: options.sessionId,
      projectId: options.projectId,
      runId: options.runId,
      profileId: options.profileId,
      status: 'complete',
      branchId: options.branchId,
      forkId: options.forkId,
      variantIndex: options.variantIndex,
      diagnostic: {
        code: 'MODEL_CONTINUATION_DROPPED',
        severity: 'warning',
        userMessage: 'Model switched. Reasoning continuation from the previous model cannot be reused.',
        providerId: options.next.providerId,
        modelId: options.next.effectiveModelId,
        technicalMessage: [
          options.previous?.providerId,
          options.previous?.effectiveModelId,
          options.previous?.protocol,
        ].filter(Boolean).join('/') || undefined,
      },
    },
  );
}
