import { AppError } from '@shared/errors/appError';
import { ADMISSION_CHECK_REMEDY, type AdmissionCheck, type AdmissionRemedy } from '@shared/constants/admissionChecks';
import { auditArgumentsHash, auditLog } from '../../runtime/AuditLog';
import {
  agentPermissionPolicyService,
  type AgentPermissionDecision,
  type AgentPermissionDecisionInput,
} from './AgentPermissionPolicy';
import {
  agentToolApprovalRequestService,
  type AutoReviewOutcome,
  type ToolApprovalRequestInput,
} from './AgentToolApprovalRequestService';
import type { RuntimePermissionState } from '@shared/types/runtimePermission';
import type { PermissionReviewer } from './PermissionReviewRuntime';

/** What the agent reads when auto-review refuses: which checks failed, who can make each hold, and the way out. */
export interface AutoReviewDenial {
  code: 'AUTO_REVIEW_DENIED';
  risk: AgentPermissionDecision['risk'];
  failedChecks: { check: AdmissionCheck; remedy: AdmissionRemedy }[];
  exits: ['human-approval', 'permission-mode'];
  reason: string;
  errorCode?: string;
}

export class ToolPermissionDenied extends AppError {
  constructor(
    message: string,
    readonly requiresApproval = false,
    readonly details?: AutoReviewDenial,
  ) {
    super('TOOL_PERMISSION_DENIED', message);
    this.name = 'ToolPermissionDenied';
  }
}

function autoReviewDenial(risk: AgentPermissionDecision['risk'], outcome: AutoReviewOutcome): ToolPermissionDenied {
  const details: AutoReviewDenial = {
    code: 'AUTO_REVIEW_DENIED',
    risk,
    failedChecks: outcome.failedChecks.map((check) => ({ check, remedy: ADMISSION_CHECK_REMEDY[check] })),
    exits: ['human-approval', 'permission-mode'],
    reason: outcome.reason,
    ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
  };
  return new ToolPermissionDenied(
    `AUTO_REVIEW_DENIED: the action was not executed.\n${JSON.stringify(details)}`,
    false,
    details,
  );
}

export interface ToolPermissionAuthorizationInput {
  decision: Omit<AgentPermissionDecisionInput, 'permissionState'>;
  approval?: Omit<ToolApprovalRequestInput, 'reason' | 'risk' | 'signal' | 'argumentsSha256'>;
  reviewer?: PermissionReviewer;
  executionBudget?: object;
  assertLive: () => void;
}

/** Every authorization attempt belongs to exactly one main-owned revision. */
export async function authorizeToolPermission(
  input: ToolPermissionAuthorizationInput,
  permissionState: RuntimePermissionState,
  signal: AbortSignal,
) {
  const decision = agentPermissionPolicyService.evaluate({ ...input.decision, permissionState });
  const toolCall = input.decision.toolCall;
  const argumentsSha256 = auditArgumentsHash(toolCall.arguments);
  const recordPolicyDecision = (approved: boolean) =>
    auditLog.record({
      kind: 'tool-decision',
      decidedBy: 'policy',
      approved,
      tool: toolCall.name,
      toolCallId: toolCall.id,
      argumentsSha256,
      risk: decision.risk,
      sessionId: input.approval?.sessionId ?? null,
      turnId: input.approval?.turnId,
      ...(decision.reason ? { reason: decision.reason.slice(0, 200) } : {}),
    });
  if (decision.action === 'deny') {
    recordPolicyDecision(false);
    throw new ToolPermissionDenied(decision.reason ?? 'Policy denied this tool call.');
  }
  if (decision.action === 'allow') recordPolicyDecision(true);
  if (decision.action === 'ask_user') {
    if (!input.approval)
      throw new ToolPermissionDenied(decision.reason ?? 'Tool approval requires an active conversation turn.', true);
    const approved = await agentToolApprovalRequestService.request({
      ...input.approval,
      argumentsSha256,
      reason: decision.reason ?? 'Tool requires approval.',
      risk: decision.risk,
      signal,
    });
    if (!approved) throw new ToolPermissionDenied('User denied this tool call.');
  }
  if (decision.action === 'auto_review') {
    if (!input.approval) throw new ToolPermissionDenied('Auto-review requires an active conversation turn.');
    const verdict = await agentToolApprovalRequestService.autoReview({
      ...input.approval,
      argumentsSha256,
      action: {
        tool: input.decision.toolCall.name,
        arguments: structuredClone(input.decision.toolCall.arguments),
        reason: decision.reason ?? 'Review required',
        facts: {
          ...decision.operationFacts,
          executionBudget: input.executionBudget ? { ...input.executionBudget, observedAt: Date.now() } : null,
        },
      },
      reviewer: input.reviewer,
      tool: input.decision.tool,
      reason: decision.reason ?? 'Tool requires review.',
      risk: decision.risk,
      signal,
    });
    if (verdict.verdict !== 'allow') throw autoReviewDenial(decision.risk, verdict);
  }
  input.assertLive();
  return decision;
}
