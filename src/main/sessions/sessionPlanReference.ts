import type { ConversationMessage, ConversationWorkBlock, ConversationToolCall } from '@shared/types/conversation';
import type { PlanReadRequest } from '@shared/types/planReview';
import { storageAdapter } from './StorageAdapter';
import { planArtifactWriter } from './sessionPlanArtifact';

const collectCalls = (blocks: ConversationWorkBlock[]): ConversationToolCall[] => blocks.flatMap(block => block.toolCalls);

/** Resolve provenance from persisted history, never from mutable session settings. */
export function resolvePlanReference(request: PlanReadRequest, history: (sessionId: string) => ConversationMessage[] =
  (sessionId) => storageAdapter.readConversationHistory(sessionId)) {
  const matches = history(request.sessionId).flatMap(message =>
    collectCalls(message.workTrace?.blocks ?? [])
      .filter(call => call.toolName === 'plan_artifact' && call.planReview?.planId === request.planId
        && call.planReview.revision === request.revision && call.planReview.uri === request.uri
        && call.planReview.hash === request.expectedHash)
      .map(call => ({ message, call })));
  if (matches.length !== 1) throw new Error('PLAN_REFERENCE_DENIED: expected one persisted plan revision.');
  const { message, call } = matches[0];
  const ownerSessionId = call.delegatedRequest?.childSessionId ?? request.sessionId;
  const source = call.delegatedRequest
    ? history(ownerSessionId).find(entry => entry.turnId === call.delegatedRequest!.turnId && entry.role === 'assistant')
    : message;
  if (!source?.agentId) throw new Error('PLAN_PROVENANCE_MISSING: creating agent is unavailable.');
  return { plan: call.planReview!, ownerSessionId, agentId: source.agentId };
}

export function readReferencedPlan(request: PlanReadRequest) {
  const reference = resolvePlanReference(request);
  const content = planArtifactWriter.readMarkdown(reference.ownerSessionId, request.uri, request.expectedHash);
  return { ...reference, ...content };
}
