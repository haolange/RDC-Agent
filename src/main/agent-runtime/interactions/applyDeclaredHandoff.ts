import { randomUUID } from 'node:crypto';
import { isHandoffContinueAction } from '@shared/types/planReview';
import { EXECUTION_OFFER_SCHEMA } from '@shared/types/executionOffer';
import { parsePlanTaskRequirements, type PlanTaskRequirement } from '@shared/types/taskExecution';
import { AppError } from '@shared/errors/appError';
import { dispatchRuntimeHooks } from '../../hooks/runtimeHookDispatch';
import { conversationHistoryStore, executionOfferStore, projectWorkspaceStore, sessionRecordStore } from '../../sessions/store/sessionStores';
import { sessionRevisions } from '../../sessions/store/SessionRevisionRegistry';
import { planReviewStateStore } from '../../sessions/run/PlanReviewStateStore';
import { planArtifactWriter } from '../../sessions/run/sessionPlanArtifact';
import { resolveEnabledAgentDefinition } from '../../settings/agent-manifests/effectiveAgentSnapshot';
import { assertDeclaredHandoffSkillCompatibility } from './handoffSkillCompatibility';
import type { AgentHandoffDefinition } from '@shared/types/agentManifest';
import type { ExecutionOffer } from '@shared/types/executionOffer';
import type { PlanReviewHandoffSuggestion } from '@shared/types/planReview';
import type { SessionRecordSnapshot } from '@shared/types/session';

export interface ApplyDeclaredHandoffInput {
  sessionId: string;
  agent: string;
  label: string;
  expectedPlanHash?: string;
}

export interface ApplyDeclaredHandoffResult {
  success: boolean;
  error?: string;
  session?: SessionRecordSnapshot;
  suggestion?: PlanReviewHandoffSuggestion;
}

/** The offer a declared handoff of an approved plan writes; the approval decision's time is the offer's time. */
export function declaredExecutionOffer(input: {
  offerId: string;
  sourceAgentId: string;
  declared: AgentHandoffDefinition;
  plan: { uri: string; hash: string };
  approvedAt: number;
}): ExecutionOffer {
  return {
    schemaVersion: EXECUTION_OFFER_SCHEMA,
    offerId: input.offerId,
    sourceAgentId: input.sourceAgentId,
    targetAgentId: input.declared.agent,
    plan: { ...input.plan },
    requiredSkillIds: [...(input.declared.requiredSkillIds ?? [])],
    requiredToolIds: [...(input.declared.requiredToolIds ?? [])],
    label: input.declared.label,
    prompt: input.declared.prompt,
    approvedAt: input.approvedAt,
  };
}

export function declaredHandoffSuggestion(declared: AgentHandoffDefinition): PlanReviewHandoffSuggestion {
  return {
    label: declared.label,
    ...(declared.labelTranslations ? { labelTranslations: { ...declared.labelTranslations } } : {}),
    agent: declared.agent,
    prompt: declared.prompt,
    send: declared.send === true,
  };
}

function findDeclaredHandoff(
  sourceAgentId: string,
  projectRoot: string | null,
  agent: string,
  label: string,
) {
  const profile = resolveEnabledAgentDefinition(sourceAgentId, projectRoot);
  return profile?.handoffs.find((handoff) => (
    handoff.agent === agent
    && handoff.label === label
    && isHandoffContinueAction(handoff)
  )) ?? null;
}

export function assertDeclaredHandoffForPlan(input: {
  sourceAgentId: string; projectRoot: string | null;
  handoff: { agent: string; label: string }; tasks: readonly PlanTaskRequirement[];
}) {
  const declared = findDeclaredHandoff(input.sourceAgentId, input.projectRoot, input.handoff.agent, input.handoff.label);
  if (!declared) throw new AppError('DECLARED_HANDOFF_NOT_FOUND', 'continue action is no longer declared.');
  const target = resolveEnabledAgentDefinition(declared.agent, input.projectRoot);
  if (!target) throw new AppError('CONVERSATION_AGENT_UNAVAILABLE', declared.agent);
  assertDeclaredHandoffSkillCompatibility({ target, requiredSkillIds: declared.requiredSkillIds ?? [], tasks: input.tasks, projectRoot: input.projectRoot });
  return declared;
}

export async function applyDeclaredHandoff(input: ApplyDeclaredHandoffInput): Promise<ApplyDeclaredHandoffResult> {
  const session = sessionRecordStore.readSession(input.sessionId);
  if (!session) return { success: false, error: `Session not found: ${input.sessionId}` };
  const projectRoot = projectWorkspaceStore.getProjectById(session.projectId)?.rootPath ?? null;
  const target = resolveEnabledAgentDefinition(input.agent, projectRoot);
  if (!target) {
    return { success: false, error: `CONVERSATION_AGENT_UNAVAILABLE: requested profile \`${input.agent}\` is not enabled.` };
  }
  const offer = executionOfferStore.read(input.sessionId);
  const sourceAgentId = findDeclaredHandoff(session.agentId ?? '', projectRoot, input.agent, input.label)
    ? (session.agentId ?? '')
    : offer?.sourceAgentId ?? session.agentId ?? '';
  const declared = findDeclaredHandoff(sourceAgentId, projectRoot, input.agent, input.label);
  if (!declared) {
    return { success: false, error: 'DECLARED_HANDOFF_NOT_FOUND: continue action is not declared on the current or offering profile.' };
  }
  const approved = planReviewStateStore.read(input.sessionId);
  if (input.expectedPlanHash && (approved?.status !== 'approved' || approved.approvedHash !== input.expectedPlanHash)) {
    return { success: false, error: 'PLAN_APPROVAL_CHANGED: the approved handoff is no longer the unsent plan.' };
  }
  const approvalChanged = () => {
    if (!input.expectedPlanHash) return false;
    const latest = planReviewStateStore.read(input.sessionId);
    return latest?.status !== 'approved' || latest.approvedHash !== input.expectedPlanHash
      || conversationHistoryStore.readConversationHistory(input.sessionId).some(message => message.role === 'user' && message.createdAt >= latest.updatedAt);
  };
  if (approvalChanged()) return { success: false, error: 'PLAN_APPROVAL_CHANGED: the approved handoff is no longer the unsent plan.' };
  if (approved?.status === 'approved' && approved.approvedHash && approved.frozenUri) {
    try {
      if (approved.approvedHandoff?.agent !== input.agent || approved.approvedHandoff.label !== input.label) {
        throw new AppError('EXECUTION_OFFER_TARGET_MISMATCH', 'declare the handoff selected by the approved plan.');
      }
      const offer = executionOfferStore.read(input.sessionId);
      if (offer && (offer.plan.hash !== approved.approvedHash || offer.plan.uri !== approved.frozenUri
        || offer.targetAgentId !== input.agent || offer.label !== input.label
        || JSON.stringify([...offer.requiredSkillIds].sort()) !== JSON.stringify([...(declared.requiredSkillIds ?? [])].sort()))) {
        throw new AppError('EXECUTION_OFFER_CHANGED', 'preparation declaration changed after approval; revise and review the plan before handoff.');
      }
      const plan = planArtifactWriter.readMarkdown(input.sessionId, approved.frozenUri, approved.approvedHash);
      assertDeclaredHandoffForPlan({ sourceAgentId, projectRoot, handoff: input, tasks: parsePlanTaskRequirements(plan.markdown) });
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  const hookContext = {
    agentId: sourceAgentId,
    sessionId: input.sessionId,
    projectRoot: projectRoot ?? undefined,
    payload: {
      toAgentId: input.agent,
      prompt: declared.prompt,
      label: declared.label,
    },
  };
  if (!await dispatchRuntimeHooks('agent.before-handoff', hookContext)) {
    return { success: false, error: 'HOOK_DENIED: agent.before-handoff' };
  }
  if (approvalChanged()) return { success: false, error: 'PLAN_APPROVAL_CHANGED: the approved handoff is no longer the unsent plan.' };
  if (approved?.status === 'approved' && approved.approvedHash && approved.frozenUri) {
    executionOfferStore.write(input.sessionId, declaredExecutionOffer({
      offerId: randomUUID(),
      sourceAgentId,
      declared,
      plan: { uri: approved.frozenUri, hash: approved.approvedHash },
      approvedAt: approved.updatedAt,
    }));
  }
  const updated = sessionRevisions.snapshot(sessionRecordStore.updateSession(input.sessionId, { agentId: input.agent }) ?? session);
  if (!await dispatchRuntimeHooks('agent.after-handoff', hookContext)) {
    return { success: false, error: 'HOOK_DENIED: agent.after-handoff' };
  }
  return {
    success: true,
    session: updated,
    suggestion: declaredHandoffSuggestion(declared),
  };
}
