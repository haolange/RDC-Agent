import type { RuntimePermissionState } from '@shared/types/runtimePermission';
import { agentPermissionPolicyService, type AgentPermissionDecisionInput } from './AgentPermissionPolicy';
import { agentToolApprovalRequestService, type ToolApprovalRequestInput } from './AgentToolApprovalRequestService';
import type { PermissionReviewer } from './PermissionReviewRuntime';

export class ToolPermissionDenied extends Error {
  constructor(message: string, readonly requiresApproval = false) { super(message); }
}

export interface ToolPermissionAuthorizationInput {
  decision: Omit<AgentPermissionDecisionInput, 'permissionState'>;
  approval?: Omit<ToolApprovalRequestInput, 'reason' | 'risk' | 'signal'>;
  reviewer?: PermissionReviewer;
  executionBudget?: object;
  assertLive: () => void;
}

/** Every authorization attempt belongs to exactly one main-owned revision. */
export async function authorizeToolPermission(input: ToolPermissionAuthorizationInput, permissionState: RuntimePermissionState, signal: AbortSignal) {
  const decision = agentPermissionPolicyService.evaluate({ ...input.decision, permissionState });
  if (decision.action === 'deny') throw new ToolPermissionDenied(decision.reason ?? 'Policy denied this tool call.');
  if (decision.action === 'ask_user') {
    if (!input.approval) throw new ToolPermissionDenied(decision.reason ?? 'Tool approval requires an active conversation turn.', true);
    const approved = await agentToolApprovalRequestService.request({ ...input.approval,
      reason: decision.reason ?? 'Tool requires approval.', risk: decision.risk, signal });
    if (!approved) throw new ToolPermissionDenied('User denied this tool call.');
  }
  if (decision.action === 'auto_review') {
    if (!input.approval) throw new ToolPermissionDenied('Auto-review requires an active conversation turn.');
    const verdict = await agentToolApprovalRequestService.autoReview({ ...input.approval,
      action: { tool: input.decision.toolCall.name, arguments: structuredClone(input.decision.toolCall.arguments),
        reason: decision.reason ?? 'Review required', facts: { ...decision.operationFacts,
          executionBudget: input.executionBudget ? { ...input.executionBudget, observedAt: Date.now() } : null } },
      reviewer: input.reviewer, reason: decision.reason ?? 'Tool requires review.', risk: decision.risk, signal });
    if (!verdict.approved) throw new ToolPermissionDenied(`AUTO_REVIEW_DENIED: risk=${decision.risk}; ${verdict.reason}`);
  }
  input.assertLive();
  return decision;
}
