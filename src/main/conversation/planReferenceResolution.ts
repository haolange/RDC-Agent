import { AppError } from '@shared/errors/appError';
import { planReviewStateStore } from '../sessions/run/PlanReviewStateStore';
import { readReferencedPlan } from '../sessions/run/sessionPlanReference';
import { resolveApprovedHandoff } from '../sessions/run/approvedHandoffRecovery';
import { storageAdapter } from '../sessions/store/StorageAdapter';
import { resolveVisibleConversationMessages } from './ConversationBranchResolver';
import type { ConversationPlanReference, PlanReadRequest, PlanReferenceRequest } from '@shared/types/planReview';

export interface ResolvedPlanReference {
  /** Persisted on the user message so the transcript can link it to the plan it acts on. */
  reference: ConversationPlanReference;
  /** Revise only: the verified source plan the planner receives as runtime material. */
  revisionSource?: { reference: PlanReadRequest; markdown: string };
}

/**
 * Verifies what a user message claims about a reviewed plan before the message is accepted. Revise needs the
 * rejected revision still current and owned by the addressed planner; execute needs the exact approved, frozen
 * revision whose declared handoff targets the addressed Agent and has not been consumed, with the message being
 * that handoff's declared prompt. Anything else fails closed.
 */
export function resolvePlanReference(input: {
  request: PlanReferenceRequest;
  sessionId: string | null;
  agentId: string | null;
  message: string;
}): ResolvedPlanReference {
  const { request } = input;
  if (request.sessionId !== input.sessionId) throw new AppError('PLAN_SESSION_DENIED', 'the plan belongs to another session.');
  return request.intent === 'revise' ? resolveRevision(request, input.agentId) : resolveExecution(request, input.agentId, input.message);
}

function resolveRevision(request: Extract<PlanReferenceRequest, { intent: 'revise' }>, agentId: string | null): ResolvedPlanReference {
  const { intent: _intent, ...readRequest } = request;
  const source = readReferencedPlan(readRequest);
  const state = planReviewStateStore.read(source.ownerSessionId);
  const history = storageAdapter.readConversationHistory(request.sessionId);
  const visible = resolveVisibleConversationMessages(history, storageAdapter.readConversationBranchState(request.sessionId));
  const review = visible.flatMap(message => message.workTrace?.blocks ?? []).flatMap(block => block.toolCalls)
    .find(call => call.planReview?.planId === request.planId && call.planReview.revision === request.revision
      && call.planReview.hash === request.expectedHash)?.planReview;
  if (source.agentId !== agentId || state?.status !== 'rejected' || state.ownerTurnId !== source.turnId
    || state.planId !== request.planId || state.revision !== request.revision || !review) {
    throw new AppError('PLAN_REVIEW_SCOPE_CHANGED', 'revision source is no longer current.');
  }
  return {
    reference: { intent: 'revise', planId: request.planId, revision: request.revision, hash: request.expectedHash,
      uri: request.uri, title: review.title, agentId: source.agentId },
    revisionSource: { reference: readRequest, markdown: source.markdown },
  };
}

function resolveExecution(request: Extract<PlanReferenceRequest, { intent: 'execute' }>, agentId: string | null, message: string): ResolvedPlanReference {
  const handoff = resolveApprovedHandoff(request.sessionId, planReviewStateStore.read(request.sessionId));
  if (!handoff) throw new AppError('PLAN_REFERENCE_INVALID', 'no approved, unsent plan handoff is pending.');
  if (handoff.planId !== request.planId || handoff.revision !== request.revision || handoff.planHash !== request.expectedHash) {
    throw new AppError('PLAN_REFERENCE_INVALID', 'the approved plan revision changed.');
  }
  if (handoff.agent !== agentId) throw new AppError('PLAN_REFERENCE_INVALID', 'the approved handoff targets another Agent.');
  if (handoff.prompt.trim() !== message.trim()) throw new AppError('PLAN_REFERENCE_INVALID', 'the message is not the declared handoff prompt.');
  return {
    reference: {
      intent: 'execute', planId: handoff.planId, revision: handoff.revision, hash: handoff.planHash, uri: handoff.planUri,
      title: handoff.planTitle, agentId: handoff.agent,
    },
  };
}
