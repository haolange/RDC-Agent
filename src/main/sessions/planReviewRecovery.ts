import type { ConversationMessage } from '@shared/types/conversation';
import type { PlanReadRequest } from '@shared/types/planReview';
import { resolveVisibleConversationMessages } from '../conversation/ConversationBranchResolver';
import { storageAdapter } from './StorageAdapter';
import { planReviewStateStore, type PlanReviewStateStore } from './PlanReviewStateStore';
import { readReferencedPlan } from './sessionPlanReference';

/** Durable plan ownership is separate from the interrupted producer's lifetime. */
export function resolveRecoverablePlan(sessionId: string, store: PlanReviewStateStore = planReviewStateStore) {
  const history = storageAdapter.readConversationHistory(sessionId);
  const branch = storageAdapter.readConversationBranchState(sessionId);
  const visible = resolveVisibleConversationMessages(history, branch);
  const candidates = visible.flatMap((message: ConversationMessage) => (message.workTrace?.blocks ?? []).flatMap(block =>
    block.toolCalls.filter(call => call.toolName === 'plan_artifact' && call.planReview).map(call => ({ message, call }))));
  for (const { message, call } of candidates.reverse()) {
    const ownerSessionId = call.delegatedRequest?.childSessionId ?? sessionId;
    const state = store.read(ownerSessionId);
    const plan = call.planReview!;
    const turnId = call.delegatedRequest?.turnId ?? message.turnId;
    if (!state || state.planId !== plan.planId || state.revision !== plan.revision) continue;
    if (!state.ownerTurnId || state.ownerTurnId !== turnId) throw new Error('PLAN_PROVENANCE_MISSING: plan ownership is unproven.');
    if (state.status !== 'awaiting' && state.status !== 'cancelled') return null;
    const reference: PlanReadRequest = { sessionId, planId: plan.planId, revision: plan.revision, uri: plan.uri, expectedHash: plan.hash };
    const source = readReferencedPlan(reference);
    return { state, reference, ownerSessionId, agentId: source.agentId, turnId,
      delegatedOwner: call.delegatedRequest ? { ownerSessionId: sessionId, childSessionId: ownerSessionId, executionId: call.delegatedRequest.executionId } : undefined,
      toolCallId: call.delegatedRequest?.toolCallId ?? call.id, planReview: plan };
  }
  const state = store.read(sessionId);
  if (state?.status === 'awaiting' || state?.status === 'cancelled') {
    throw new Error('PLAN_REVIEW_SOURCE_UNAVAILABLE: current revision has no matching owner on the selected branch.');
  }
  return null;
}
