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
import { decideAdmission, type TurnAdmission } from './PermissionAdmission';
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
  /** This turn's admission (host facts first) and the review model for what they leave open. */
  review?: { admission?: TurnAdmission; reviewPermission?: PermissionReviewer };
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
    const reason = decision.reason ?? 'Review required';
    const admission = input.review?.admission;
    const { route, settle } = admission
      ? admission.assess(
          {
            decision,
            toolCall,
            tool: input.decision.tool,
            executionContext: input.decision.executionContext,
          },
          argumentsSha256,
        )
      : { route: decideAdmission(null, decision.risk, reason), settle: undefined };
    const verdict = await agentToolApprovalRequestService.autoReview({
      ...input.approval,
      argumentsSha256,
      route,
      action: {
        tool: input.decision.toolCall.name,
        arguments: structuredClone(input.decision.toolCall.arguments),
        reason,
        facts: {
          ...decision.operationFacts,
          ...(route.route === 'model' && route.facts.length ? { hostChecks: route.facts } : {}),
          executionBudget: input.executionBudget ? { ...input.executionBudget, observedAt: Date.now() } : null,
        },
      },
      reviewer: input.review?.reviewPermission,
      tool: input.decision.tool,
      reason: decision.reason ?? 'Tool requires review.',
      risk: decision.risk,
      signal,
    });
    if (verdict.verdict === 'undecidable' && !verdict.errorCode) {
      // The one way out of an undecidable review: the user decides this exact call once. Never a mode change.
      const approved = await agentToolApprovalRequestService.request({
        ...input.approval,
        argumentsSha256,
        reason,
        risk: decision.risk,
        signal,
        escalation: { reviewer: 'auto_review', reviewMethod: verdict.reviewMethod, failedChecks: verdict.failedChecks },
      });
      if (!approved) {
        settle?.(
          { verdict: 'deny', failedChecks: verdict.failedChecks, reason: 'The user denied this action.' },
          { byUser: true },
        );
        throw new ToolPermissionDenied('User denied this tool call after auto-review could not decide it.');
      }
      settle?.({ verdict: 'allow', failedChecks: [], reason: 'The user approved this action once.' });
    } else {
      if (!verdict.errorCode) settle?.(verdict);
      if (verdict.verdict !== 'allow') throw autoReviewDenial(decision.risk, verdict);
    }
  }
  input.assertLive();
  return decision;
}
