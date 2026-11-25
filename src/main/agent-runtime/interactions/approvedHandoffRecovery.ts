import { parsePlanTaskRequirements } from '../../sessions/run/planTaskRequirements';
import { resolveVisibleConversationMessages } from '../../sessions/store/ConversationBranchResolver';
import { conversationHistoryStore, executionOfferStore, projectWorkspaceStore, sessionRecordStore } from '../../sessions/store/sessionStores';
import { readReferencedPlan } from '../../sessions/run/sessionPlanReference';
import { assertDeclaredHandoffForPlan } from './applyDeclaredHandoff';
import type { RecoverableApprovedHandoff } from '@shared/types/planReview';
import type { PlanReviewStateDocument } from '../../sessions/run/PlanReviewStateStore';

/** An accepted user request after approval may already have consumed the intended action. */
export function hasRequestAfterApproval(sessionId: string, approval: PlanReviewStateDocument): boolean {
  return conversationHistoryStore.readConversationHistory(sessionId).some(message =>
    message.role === 'user' && message.createdAt >= approval.updatedAt);
}

/** Project a manual action only while the exact approved plan is still the unsent offer. */
export function resolveApprovedHandoff(sessionId: string, approval: PlanReviewStateDocument | null): RecoverableApprovedHandoff | null {
  if (!approval || approval.status !== 'approved' || !approval.ownerTurnId || !approval.approvedHash
    || !approval.frozenUri || !approval.approvedHandoff || hasRequestAfterApproval(sessionId, approval)) return null;
  const offer = executionOfferStore.read(sessionId);
  if (!offer || offer.plan.hash !== approval.approvedHash || offer.plan.uri !== approval.frozenUri
    || offer.approvedAt !== approval.updatedAt || offer.targetAgentId !== approval.approvedHandoff.agent
    || offer.label !== approval.approvedHandoff.label) return null;

  const history = conversationHistoryStore.readConversationHistory(sessionId);
  const visible = resolveVisibleConversationMessages(history, conversationHistoryStore.readConversationBranchState(sessionId));
  const ownerReview = visible.filter(message => message.turnId === approval.ownerTurnId && message.agentId === offer.sourceAgentId)
    .flatMap(message => (message.workTrace?.blocks ?? []).flatMap(block => block.toolCalls))
    .find(call => call.toolName === 'plan_artifact' && call.planReview?.planId === approval.planId
      && call.planReview.revision === approval.revision && call.planReview.hash === approval.approvedHash)?.planReview;
  if (!ownerReview) return null;
  const source = readReferencedPlan({ sessionId, planId: approval.planId, revision: approval.revision,
    uri: approval.frozenUri, expectedHash: approval.approvedHash });
  if (source.ownerSessionId !== sessionId || source.turnId !== approval.ownerTurnId || source.agentId !== offer.sourceAgentId) return null;
  const session = sessionRecordStore.readSession(sessionId);
  if (!session) return null;
  const projectRoot = projectWorkspaceStore.getProjectById(session.projectId)?.rootPath ?? null;
  const declared = assertDeclaredHandoffForPlan({ sourceAgentId: offer.sourceAgentId, projectRoot,
    handoff: { agent: offer.targetAgentId, label: offer.label }, tasks: parsePlanTaskRequirements(source.markdown) });
  const same = (left: readonly string[], right: readonly string[]) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  if (declared.prompt !== offer.prompt || !same(declared.requiredSkillIds ?? [], offer.requiredSkillIds)
    || !same(declared.requiredToolIds ?? [], offer.requiredToolIds ?? [])) return null;
  return { agent: declared.agent, label: declared.label, ...(declared.labelTranslations ? { labelTranslations: declared.labelTranslations } : {}),
    prompt: declared.prompt, send: declared.send === true, planId: approval.planId, revision: approval.revision,
    planHash: approval.approvedHash, planUri: approval.frozenUri, planTitle: ownerReview.title };
}
