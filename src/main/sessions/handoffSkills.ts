import { planReviewStateStore } from './PlanReviewStateStore';
import { storageAdapter } from './StorageAdapter';
import { executionOfferMatches } from './ExecutionOfferStore';

/** Preload only the skills frozen on the session execution offer for this recipient. */
export function executionOfferRequiredSkillIds(sessionId: string | null | undefined, agentId: string): string[] {
  if (!sessionId) return [];
  const offer = storageAdapter.executionOffers.read(sessionId);
  const approved = planReviewStateStore.read(sessionId);
  if (!approved || approved.status !== 'approved') return [];
  if (!executionOfferMatches(offer, {
    agentId,
    planHash: approved.approvedHash,
    planUri: approved.frozenUri,
  })) {
    return [];
  }
  return [...new Set(offer.requiredSkillIds)];
}
