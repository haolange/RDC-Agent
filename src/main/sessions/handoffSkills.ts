import { planReviewStateStore } from './PlanReviewStateStore';
import { storageAdapter } from './StorageAdapter';
import { executionOfferMatches } from './ExecutionOfferStore';
import type { ExecutionOffer } from '@shared/types/executionOffer';

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
  return offer;
}

/** Preload only the skills frozen on the session execution offer for this recipient. */
export function executionOfferRequiredSkillIds(sessionId: string | null | undefined, agentId: string): string[] {
  const offer = approvedExecutionOfferForAgent(sessionId, agentId);
  if (!offer) return [];
  return [...new Set(offer.requiredSkillIds)];
}
