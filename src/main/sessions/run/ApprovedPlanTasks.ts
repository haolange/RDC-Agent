import { parsePlanTaskRequirements, type PlanTaskRequirement } from '@shared/types/taskExecution';
import { executionOfferStore } from '../store/sessionStores';
import { planArtifactWriter } from './sessionPlanArtifact';

/** The approved, hash-bound plan is authority; never infer requirements from a description. */
export function readApprovedPlanTasks(sessionId: string): PlanTaskRequirement[] {
  const offer = executionOfferStore.read(sessionId);
  if (!offer) return [];
  const plan = planArtifactWriter.readMarkdown(sessionId, offer.plan.uri, offer.plan.hash);
  return parsePlanTaskRequirements(plan.markdown);
}
