import type { PlanReviewStateDocument, RecoverableApprovedHandoff } from '@shared/types/planReview';
import { parsePlanTaskRequirements } from '@shared/types/taskExecution';
import { resolveVisibleConversationMessages } from '../../conversation/ConversationBranchResolver';
import { assertDeclaredHandoffForPlan } from '../../conversation/applyDeclaredHandoff';
import { storageAdapter } from '../store/StorageAdapter';
import { readReferencedPlan } from './sessionPlanReference';

/** An accepted user request after approval may already have consumed the intended action. */
export function hasRequestAfterApproval(sessionId: string, approval: PlanReviewStateDocument): boolean {
  return storageAdapter.readConversationHistory(sessionId).some(message =>
    message.role === 'user' && message.createdAt >= approval.updatedAt);
}

/** Project a manual action only while the exact approved plan is still the unsent offer. */
export function resolveApprovedHandoff(sessionId: string, approval: PlanReviewStateDocument | null): RecoverableApprovedHandoff | null {
  if (!approval || approval.status !== 'approved' || !approval.ownerTurnId || !approval.approvedHash
    || !approval.frozenUri || !approval.approvedHandoff || hasRequestAfterApproval(sessionId, approval)) return null;
  const offer = storageAdapter.executionOffers.read(sessionId);
  if (!offer || offer.plan.hash !== approval.approvedHash || offer.plan.uri !== approval.frozenUri
    || offer.approvedAt !== approval.updatedAt || offer.targetAgentId !== approval.approvedHandoff.agent
    || offer.label !== approval.approvedHandoff.label) return null;

  const history = storageAdapter.readConversationHistory(sessionId);
  const visible = resolveVisibleConversationMessages(history, storageAdapter.readConversationBranchState(sessionId));
  const owner = visible.find(message => message.turnId === approval.ownerTurnId && message.agentId === offer.sourceAgentId
    && (message.workTrace?.blocks ?? []).some(block => block.toolCalls.some(call => call.toolName === 'plan_artifact'
      && call.planReview?.planId === approval.planId && call.planReview.revision === approval.revision
      && call.planReview.hash === approval.approvedHash)));
  if (!owner) return null;
  const source = readReferencedPlan({ sessionId, planId: approval.planId, revision: approval.revision,
    uri: approval.frozenUri, expectedHash: approval.approvedHash });
  if (source.ownerSessionId !== sessionId || source.turnId !== approval.ownerTurnId || source.agentId !== offer.sourceAgentId) return null;
  const session = storageAdapter.readSession(sessionId);
  if (!session) return null;
  const projectRoot = storageAdapter.getProjectById(session.projectId)?.rootPath ?? null;
  const declared = assertDeclaredHandoffForPlan({ sourceAgentId: offer.sourceAgentId, projectRoot,
    handoff: { agent: offer.targetAgentId, label: offer.label }, tasks: parsePlanTaskRequirements(source.markdown) });
  const same = (left: readonly string[], right: readonly string[]) => JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
  if (declared.prompt !== offer.prompt || !same(declared.requiredSkillIds ?? [], offer.requiredSkillIds)
    || !same(declared.requiredToolIds ?? [], offer.requiredToolIds ?? [])) return null;
  return { agent: declared.agent, label: declared.label, ...(declared.labelTranslations ? { labelTranslations: declared.labelTranslations } : {}),
    prompt: declared.prompt, send: declared.send === true, planHash: approval.approvedHash };
}
