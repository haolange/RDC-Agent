import { executionOfferStore } from '../store/sessionStores';
import { parsePlanTaskRequirements } from './planTaskRequirements';
import { planArtifactWriter } from './sessionPlanArtifact';
import type { PlanTaskRequirement } from './planTaskRequirements';

/** The approved, hash-bound plan is authority; never infer requirements from a description. */
export function readApprovedPlanTasks(sessionId: string): PlanTaskRequirement[] {
  const offer = executionOfferStore.read(sessionId);
  if (!offer) return [];
  const plan = planArtifactWriter.readMarkdown(sessionId, offer.plan.uri, offer.plan.hash);
  return parsePlanTaskRequirements(plan.markdown);
}
