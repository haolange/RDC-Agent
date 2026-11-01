import type { ConversationMessage, ConversationWorkBlock, ConversationToolCall } from '@shared/types/conversation';
import type { PlanReadRequest } from '@shared/types/planReview';
import { storageAdapter } from './StorageAdapter';
import { planArtifactWriter } from './sessionPlanArtifact';
import { planReviewStateStore } from './PlanReviewStateStore';

const collectCalls = (blocks: ConversationWorkBlock[]): ConversationToolCall[] => blocks.flatMap(block => block.toolCalls);

function matchesPlanUri(request: PlanReadRequest, call: ConversationToolCall): boolean {
  if (call.planReview?.uri === request.uri) return true;
  const owner = call.delegatedRequest?.childSessionId ?? request.sessionId;
  const approved = planReviewStateStore.read(owner);
  return approved?.status === 'approved' && approved.planId === request.planId && approved.revision === request.revision
    && approved.frozenUri === request.uri && approved.approvedHash === request.expectedHash;
}

/** Resolve provenance from persisted history, never from mutable session settings. */
export function resolvePlanReference(request: PlanReadRequest, history: (sessionId: string) => ConversationMessage[] =
  (sessionId) => storageAdapter.readConversationHistory(sessionId)) {
  const matches = history(request.sessionId).flatMap(message =>
    collectCalls(message.workTrace?.blocks ?? [])
      .filter(call => call.toolName === 'plan_artifact' && call.planReview?.planId === request.planId
        && call.planReview.revision === request.revision && matchesPlanUri(request, call)
        && call.planReview.hash === request.expectedHash)
      .map(call => ({ message, call })));
  if (matches.length !== 1) throw new Error('PLAN_REFERENCE_DENIED: expected one persisted plan revision.');
  const { message, call } = matches[0];
  const ownerSessionId = call.delegatedRequest?.childSessionId ?? request.sessionId;
  const source = call.delegatedRequest
    ? history(ownerSessionId).find(entry => entry.turnId === call.delegatedRequest!.turnId && entry.role === 'assistant')
    : message;
  if (!source?.agentId) throw new Error('PLAN_PROVENANCE_MISSING: creating agent is unavailable.');
  return { plan: call.planReview!, ownerSessionId, agentId: source.agentId,
    turnId: call.delegatedRequest?.turnId ?? message.turnId };
}

export function readReferencedPlan(request: PlanReadRequest) {
  const reference = resolvePlanReference(request);
  const content = planArtifactWriter.readMarkdown(reference.ownerSessionId, request.uri, request.expectedHash);
  return { ...reference, ...content };
}
