import { planReviewStateStore } from './PlanReviewStateStore';
import { storageAdapter } from '../store/StorageAdapter';
import { executionOfferMatches } from './ExecutionOfferStore';
import type { ExecutionOffer } from '@shared/types/executionOffer';
import { z } from 'zod';

const completionReceiptSchema = z.object({
  offerId: z.string().uuid().optional(), planUri: z.string().min(1),
  planHash: z.string().regex(/^(?:sha256:)?[a-f0-9]{64}$/),
}).strict();

/** Return only an offer bound to this recipient and the currently approved frozen plan. */
export function approvedExecutionOfferForAgent(
  sessionId: string | null | undefined,
  agentId: string,
): ExecutionOffer | null {
  if (!sessionId) return null;
  const offer = storageAdapter.executionOffers.read(sessionId);
  const approved = planReviewStateStore.read(sessionId);
  if (!approved || approved.status !== 'approved'
    || !approved.approvedHash || !approved.frozenUri
    || approved.approvedHandoff?.agent !== agentId) return null;
  if (!executionOfferMatches(offer, {
    agentId,
    planHash: approved.approvedHash,
    planUri: approved.frozenUri,
  })) {
    return null;
  }
  const completions = storageAdapter.readSessionContextJournal(sessionId, entry => entry.approvedExecutionCompletion !== undefined);
  for (const entry of completions) {
    const receipt = completionReceiptSchema.parse(entry.approvedExecutionCompletion);
    if (entry.status === 'complete' && receipt.offerId === offer.offerId
      && receipt.planUri === offer.plan.uri && receipt.planHash === offer.plan.hash) return null;
  }
  // The approved decision owns this timestamp. Declaring a handoff must not
  // replace it, including when reading an offer written before that fix.
  return { ...offer, approvedAt: approved.updatedAt };
}

/** A prepared turn cannot complete under an offer changed or withdrawn while it was running. */
export function assertApprovedExecutionCurrent(sessionId: string, agentId: string, prepared: ExecutionOffer): void {
  const current = approvedExecutionOfferForAgent(sessionId, agentId);
  if (!current || JSON.stringify(current) !== JSON.stringify(prepared)) {
    throw new Error('APPROVED_PLAN_CHANGED: the approved execution offer changed during this turn.');
  }
}

/** Preload only the skills frozen on the session execution offer for this recipient. */
export function executionOfferRequiredSkillIds(sessionId: string | null | undefined, agentId: string): string[] {
  const offer = approvedExecutionOfferForAgent(sessionId, agentId);
  if (!offer) return [];
  return [...new Set(offer.requiredSkillIds)];
}
