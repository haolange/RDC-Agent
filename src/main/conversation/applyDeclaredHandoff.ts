import type { SessionRecord } from '@shared/types/session';
import type { PlanReviewHandoffSuggestion } from '@shared/types/planReview';
import { isHandoffContinueAction } from '@shared/types/planReview';
import { EXECUTION_OFFER_SCHEMA } from '@shared/types/executionOffer';
import { nowMs } from '@shared/utils/id';
import { dispatchRuntimeHooks } from '../hooks/runtimeHookDispatch';
import { resolveEnabledAgentDefinition } from './ConversationRoutePreflight';
import { storageAdapter } from '../sessions/StorageAdapter';
import { planReviewStateStore } from '../sessions/PlanReviewStateStore';

export interface ApplyDeclaredHandoffInput {
  sessionId: string;
  agent: string;
  label: string;
}

export interface ApplyDeclaredHandoffResult {
  success: boolean;
  error?: string;
  session?: SessionRecord;
  suggestion?: PlanReviewHandoffSuggestion;
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

export async function applyDeclaredHandoff(input: ApplyDeclaredHandoffInput): Promise<ApplyDeclaredHandoffResult> {
  const session = storageAdapter.readSession(input.sessionId);
  if (!session) return { success: false, error: `Session not found: ${input.sessionId}` };
  const projectRoot = storageAdapter.getProjectById(session.projectId)?.rootPath ?? null;
  const target = resolveEnabledAgentDefinition(input.agent, projectRoot);
  if (!target) {
    return { success: false, error: `CONVERSATION_AGENT_UNAVAILABLE: requested profile \`${input.agent}\` is not enabled.` };
  }
  const offer = storageAdapter.executionOffers.read(input.sessionId);
  const sourceAgentId = findDeclaredHandoff(session.agentId ?? '', projectRoot, input.agent, input.label)
    ? (session.agentId ?? '')
    : offer?.sourceAgentId ?? session.agentId ?? '';
  const declared = findDeclaredHandoff(sourceAgentId, projectRoot, input.agent, input.label);
  if (!declared) {
    return { success: false, error: 'DECLARED_HANDOFF_NOT_FOUND: continue action is not declared on the current or offering profile.' };
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
  const approved = planReviewStateStore.read(input.sessionId);
  if (approved?.status === 'approved' && approved.approvedHash && approved.frozenUri) {
    storageAdapter.executionOffers.write(input.sessionId, {
      schemaVersion: EXECUTION_OFFER_SCHEMA,
      sourceAgentId,
      targetAgentId: input.agent,
      plan: { uri: approved.frozenUri, hash: approved.approvedHash },
      requiredSkillIds: [...(declared.requiredSkillIds ?? [])],
      label: declared.label,
      prompt: declared.prompt,
      approvedAt: nowMs(),
    });
  }
  const updated = storageAdapter.updateSession(input.sessionId, { agentId: input.agent });
  if (!await dispatchRuntimeHooks('agent.after-handoff', hookContext)) {
    return { success: false, error: 'HOOK_DENIED: agent.after-handoff' };
  }
  return {
    success: true,
    session: updated ?? session,
    suggestion: {
      label: declared.label,
      agent: declared.agent,
      prompt: declared.prompt,
      send: declared.send === true,
    },
  };
}

export function writeExecutionOfferFromApproval(input: {
  sessionId: string;
  sourceAgentId: string;
  projectRoot: string | null;
  handoff: { label: string; agent: string };
  plan: { uri: string; hash: string };
}): PlanReviewHandoffSuggestion | null {
  const declared = findDeclaredHandoff(input.sourceAgentId, input.projectRoot, input.handoff.agent, input.handoff.label);
  if (!declared) return null;
  storageAdapter.executionOffers.write(input.sessionId, {
    schemaVersion: EXECUTION_OFFER_SCHEMA,
    sourceAgentId: input.sourceAgentId,
    targetAgentId: declared.agent,
    plan: input.plan,
    requiredSkillIds: [...(declared.requiredSkillIds ?? [])],
    label: declared.label,
    prompt: declared.prompt,
    approvedAt: nowMs(),
  });
  return {
    label: declared.label,
    agent: declared.agent,
    prompt: declared.prompt,
    send: declared.send === true,
  };
}
