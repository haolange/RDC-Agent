import { permissionReviewAuthority, permissionReviewEvidence } from '../permissions/PermissionReviewAuthority';
import { executePermissionReview, type PermissionReviewer } from '../permissions/PermissionReviewRuntime';
import { TurnAdmission } from '../permissions/PermissionAdmission';
import { withPermissionReviewRoute } from '../permissions/PermissionReviewRoute';
import type { AgentTurnRun } from './AgentTurnRunner';

/**
 * This turn's admission and review model. Admission reads the approved plan and the capture readiness of the turn;
 * the reviewer sees only what admission leaves open, with the turn's authority and its own slot's observations.
 */
export function createTurnPermissionReview(run: AgentTurnRun): {
  admission: TurnAdmission;
  reviewPermission: PermissionReviewer;
} {
  const { input, preparedRuntime, requestPlan, turnHandle, executionScopeId } = run;
  const { promptPlan, effectivePlan, approvedExecution } = preparedRuntime;
  const admission = new TurnAdmission({
    sessionId: executionScopeId,
    projectId: input.projectId ?? null,
    turnId: turnHandle.turnId,
    agentId: input.agentId,
    accessCeiling: effectivePlan.accessCeiling,
    approved: approvedExecution
      ? { approvedAt: approvedExecution.offer.approvedAt, contract: approvedExecution.investigation }
      : null,
    captureReadiness: () => turnHandle.captureControl?.readiness() ?? null,
  });
  const reviewPermission: PermissionReviewer = (action, signal) =>
    withPermissionReviewRoute(
      preparedRuntime.permissionReview,
      { providerId: requestPlan.providerId, credentialHandle: preparedRuntime.credentialHandle },
      (route, credentialHandle) =>
        executePermissionReview({
          sessionId: executionScopeId,
          plan: route.requestPlan,
          credentialHandle,
          reasoning: route.reasoning,
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
        }),
    );
  return { admission, reviewPermission };
}
