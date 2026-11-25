import { AppError } from '@shared/errors/appError';
import { planReviewStateStore } from '../sessions/run/PlanReviewStateStore';
import { executionOfferStore } from '../sessions/store/sessionStores';
import { planArtifactWriter } from '../sessions/run/sessionPlanArtifact';
import type { TurnHandle } from '../agent-runtime/orchestration/TurnCoordinator';

/** A plan gate ends its owning turn; it is neither a model final answer nor Mission completion. */
export function verifyApprovedPlanExit(sessionId: string | null | undefined, turnId: string,
  approved: TurnHandle['approvedPlan'] | undefined): boolean {
  if (!approved) return false;
  const state = sessionId ? planReviewStateStore.read(sessionId) : null;
  const offer = sessionId ? executionOfferStore.read(sessionId) : null;
  if (!sessionId || state?.status !== 'approved' || state.ownerTurnId !== turnId
    || state.planId !== approved.planId || state.approvedHash !== approved.hash
    || state.frozenUri !== approved.frozenUri || state.approvedHandoff?.agent !== approved.target
    || offer?.plan.hash !== approved.hash || offer.plan.uri !== approved.frozenUri
    || offer.targetAgentId !== approved.target) {
    throw new AppError('PLAN_REVIEW_SCOPE_CHANGED', 'normal plan exit requires its owning frozen approval and execution offer.');
  }
  planArtifactWriter.readMarkdown(sessionId, approved.frozenUri, approved.hash);
  return true;
}
