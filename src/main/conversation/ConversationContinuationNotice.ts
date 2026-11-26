import { conversationTurnIds } from '@shared/conversation/conversationTurnIds';
import { createConversationMessage } from './ConversationRoutePreflight';
import type { ConversationContinuationDrop, ConversationMessage } from '@shared/types/conversation';
import type { RequestPlan } from '@shared/types/providerCapability';
import type { PreparedTurnContextSummary } from '@shared/types/session';

/** Drop reasons caused by a route or model change; other reasons (scope-ended, retention-expired, ...) are routine. */
const ROUTE_CHANGE_DROP_REASONS: ReadonlySet<string> = new Set([
  'execution-mismatch',
  'model-not-admitted',
  'container-mismatch',
]);

/** The artifacts preparation dropped because the route or model changed, or null when none were. */
export function summarizeContinuationDrop(
  decisionCounts: PreparedTurnContextSummary['continuation']['decisionCounts'],
): ConversationContinuationDrop | null {
  const reasons = decisionCounts.filter((entry) => entry.count > 0 && ROUTE_CHANGE_DROP_REASONS.has(entry.reason));
  const count = reasons.reduce((sum, entry) => sum + entry.count, 0);
  return count > 0 ? { count, reasons: reasons.map(({ reason, count: n }) => ({ reason, count: n })) } : null;
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
  drop: ConversationContinuationDrop;
  next: RequestPlan;
}): ConversationMessage {
  return createConversationMessage('system', continuationDropText(options.drop.count), {
    id: conversationTurnIds(options.requestId).noticeMessageId,
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
      userMessage: continuationDropText(options.drop.count),
      continuationDrop: options.drop,
      providerId: options.next.providerId,
      modelId: options.next.effectiveModelId,
    },
  });
}

function continuationDropText(count: number): string {
  return `Model switched. ${count} reasoning continuation item(s) from the previous model cannot be reused.`;
}
