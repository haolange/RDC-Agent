import {
  permissionReviewAuthority,
  verifiedCaptureBaseline,
  permissionReviewEvidence,
} from '../permissions/PermissionReviewAuthority';
import { executePermissionReview, type PermissionReviewer } from '../permissions/PermissionReviewRuntime';
import { TurnAdmission } from '../permissions/PermissionAdmission';
import type { AgentTurnRun } from './AgentTurnRunner';

/**
 * This turn's admission and review model. Admission reads the approved plan and verified entry position of the turn;
 * the reviewer sees only what admission leaves open, with the turn's authority and its own slot's observations.
 */
export function createTurnPermissionReview(run: AgentTurnRun): {
  admission: TurnAdmission;
  reviewPermission: PermissionReviewer;
} {
  const { input, preparedRuntime, requestPlan, turnHandle, executionScopeId } = run;
  const { promptPlan, routeCapability, effectivePlan, approvedExecution } = preparedRuntime;
  const captureInputs = approvedExecution?.investigation?.captureScope?.inputs ?? null;
  const admission = new TurnAdmission({
    sessionId: executionScopeId,
    projectId: input.projectId ?? null,
    turnId: turnHandle.turnId,
    agentId: input.agentId,
    accessCeiling: effectivePlan.accessCeiling,
    approved: approvedExecution
      ? {
          approvedAt: approvedExecution.offer.approvedAt,
          captureInputIds: captureInputs ? captureInputs.map((entry) => entry.inputId) : null,
        }
      : null,
    captureBaseline: () =>
      verifiedCaptureBaseline({
        controller: turnHandle.captureControl,
        sessionId: executionScopeId,
        projectId: input.projectId,
        turnId: turnHandle.turnId,
        agentId: input.agentId,
        accessCeiling: effectivePlan.accessCeiling,
      }),
  });
  const reviewPermission: PermissionReviewer = (action, signal) =>
    executePermissionReview({
      sessionId: executionScopeId,
      plan: requestPlan,
      credentialHandle: preparedRuntime.credentialHandle,
      reasoning: routeCapability.reasoningContract,
      evidence: permissionReviewEvidence(run.slot?.agent.messages ?? [], executionScopeId, action.arguments),
      authority: permissionReviewAuthority({
        sessionId: executionScopeId,
        messages: input.initialMessages ?? [],
        currentRequest: input.content,
        promptPlan,
        workspace: effectivePlan.projectRootPath,
        agentId: input.agentId,
        delegated: !!effectivePlan.delegationCapsule,
      }),
      action,
      signal,
    });
  return { admission, reviewPermission };
}
