/**
 * AgentTurnCompletionGuards — what a running turn must settle before it may end: capture
 * restoration, completion readiness, unsettled direct Tasks, a delegated structured result,
 * a reviewed Mission plan and the approved goal's closing checks.
 */

import { assertApprovedExecutionCurrent } from '../../sessions/run/handoffSkills';
import { listUnfinishedDirectTasks } from './DirectTaskTurnLifecycle';
import { completionBudgetEvidence } from './CompletionBudgetEvidence';
import type { createApprovedGoalContinuation } from './ApprovedGoalContinuation';
import type { TurnCompletionDeclaration } from './TurnCoordinator';
import type { AgentTurnRun } from './AgentTurnRunner';
import type { TurnCompletionReadinessValidator, TurnCompletionValidator } from '../agent/TurnCompletionValidator';
import type { AgentLoopConfig } from '../agent/AgentLoop';
import type { EffectiveRuntimePlan } from '../EffectiveRuntimePlan';

type ApprovedGoalContinuation = ReturnType<typeof createApprovedGoalContinuation>;
type CaptureRestorationFeedback = (declaration: TurnCompletionDeclaration | null) => Promise<string | undefined>;

/**
 * Feedback while the approved capture is not back at its signed entry position. An acknowledged
 * restore failure in a partial/blocked declaration needs no further feedback.
 */
export function createCaptureRestorationFeedback(run: AgentTurnRun): CaptureRestorationFeedback {
  const { turnHandle } = run;
  return async (declaration) => {
    const control = turnHandle.captureControl;
    if (!control) return undefined;
    run.captureRestoreFailure = control.lastRestoreError ?? run.captureRestoreFailure;
    const acknowledged = run.captureRestoreFailure && declaration?.disposition !== 'completed'
      && declaration?.result?.recoveryState.some(value => value.includes(run.captureRestoreFailure!));
    if (acknowledged) return undefined;
    try {
      const status = await control.restorationStatus(turnHandle.signal);
      if (!status.restored) return `# Capture Restoration Required\nFrozen signed entry baseline: ${JSON.stringify({ receipt: status.receipt, original: status.original })}\nHost-observed current position: ${JSON.stringify(status.current)}\nUse rdc_probe capture_restore under the current permission mode to restore the signed entry position. If restore fails, record the actual failure and remaining recovery in turn_complete.result.recoveryState and unresolved.`;
      run.captureRestoreFailure = null;
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      run.captureRestoreFailure = /^[A-Z][A-Z0-9_]{0,127}/u.exec(message)?.[0] ?? 'RDC_RESTORE_UNCONFIRMED';
      return `# Capture Restoration Unconfirmed\n${message}\nDo not declare completed. Record ${run.captureRestoreFailure} and the actual remaining recovery in turn_complete.result.recoveryState and unresolved, then report a partial or blocked outcome.`;
    }
  };
}

/** turn_complete runs the injected readiness validator, then requires the capture to be restored. */
export function installCompletionReadinessValidator(
  run: AgentTurnRun,
  validateCompletionReadiness: TurnCompletionReadinessValidator,
  approvedGoalContinuation: ApprovedGoalContinuation,
  captureRestorationFeedback: CaptureRestorationFeedback,
): void {
  const { input, preparedRuntime, turnHandle, executionScopeId } = run;
  turnHandle.validateCompletionReadiness = async (declaration) => {
    await validateCompletionReadiness({
      profileId: input.agentId,
      completionContract: preparedRuntime.approvedExecution?.investigation ? 'investigation-report' : preparedRuntime.effectivePlan.completionContract,
      investigationMission: preparedRuntime.approvedExecution?.investigation?.mission ?? preparedRuntime.effectivePlan.investigationMission ?? undefined,
      sessionId: executionScopeId, turnId: turnHandle.turnId,
      disposition: declaration.disposition, evidenceRefs: declaration.evidenceRefs,
      budgetEvidence: completionBudgetEvidence(turnHandle),
    });
    const feedback = await captureRestorationFeedback(declaration);
    if (feedback) {
      if (preparedRuntime.approvedExecution && ['partial', 'blocked'].includes(declaration.disposition)) {
        run.captureRestorationNeededForPartial = true;
      }
      throw new Error(feedback);
    }
    if (run.captureRestorationNeededForPartial && turnHandle.captureControl && !run.captureRestoreFailure) {
      run.captureRestorationNeededForPartial = false;
      // The declaration is recorded; its review states what the restored position makes possible again.
      approvedGoalContinuation.noteConditionsChanged('The host now verifies the signed entry position, so work that needed it may be possible again; continue it with the existing Task, preserving its consumption and deadline.');
    }
  };
}

/** A Mission planning turn must end with a reviewed plan (or a completed declaration). */
export function createMissionPlanningFeedback(run: AgentTurnRun, effectivePlan: EffectiveRuntimePlan): () => string | undefined {
  const { turnHandle, preparedRuntime } = run;
  return () => {
    const plan = turnHandle.runtimePlan ?? effectivePlan;
    if (!plan.investigationMission || !plan.profileHandoffs.some(handoff => handoff.surface === 'plan-gate')
      || preparedRuntime.approvedExecution || turnHandle.approvedPlan || turnHandle.completionDeclaration?.disposition === 'completed') return undefined;
    return '# Mission Plan Required\nSubmit a plan with plan_artifact for user review, or use ask_user when clarification is needed before planning.';
  };
}

/**
 * The guard the loop consults before accepting a terminal response in a session turn: it returns
 * feedback that keeps the turn running until its obligations are settled.
 */
export function createTerminalResponseGuard(
  run: AgentTurnRun,
  guards: {
    validateCompletion: TurnCompletionValidator;
    approvedGoalContinuation: ApprovedGoalContinuation;
    captureRestorationFeedback: CaptureRestorationFeedback;
    missionPlanningFeedback: () => string | undefined;
    toolCallsAtEntry: number;
  },
): AgentLoopConfig['beforeTerminalResponse'] {
  const { input, preparedRuntime, turnHandle, executionScopeId } = run;
  const { approvedGoalContinuation, captureRestorationFeedback, missionPlanningFeedback, toolCallsAtEntry } = guards;
  const capsule = preparedRuntime.effectivePlan.delegationCapsule;
  if (!input.sessionId) return undefined;
  const sessionId = input.sessionId;
  return async (message) => {
    if (turnHandle.isAborted) return undefined;
    const unfinished = await listUnfinishedDirectTasks({
      sessionId, turnId: turnHandle.turnId, generation: turnHandle.generation,
    });
    if (unfinished.length) {
      const redeclare = turnHandle.completionDeclaration
        ? '\nThe previous completion declaration is no longer active; declare completion again after settling the Tasks.' : '';
      turnHandle.completionDeclaration = null;
      return `# Unsettled Direct Tasks\nThe current turn still owns unfinished direct Tasks: ${unfinished.map(item => item.taskId).join(', ')}. Continue useful work within the authorized scope, or use task_update to record a concrete blocker. Settle the Tasks before ending the turn; do not reset consumption or alter the deadline.${redeclare}`;
    }
    if (capsule && !turnHandle.completionDeclaration?.result) {
      return '# Delegated Result Required\nThe delegated execution has not declared a structured result. Use turn_complete with result.summary, result.outputs (including the Task completion keys), counterevidence, unresolved, scope, sideEffects and recoveryState. Preserve the actual evidence and choose an honest partial or blocked disposition when work cannot be completed. Do not invent results, reset consumption or alter the deadline.';
    }
    const planningFeedback = missionPlanningFeedback();
    if (planningFeedback) return planningFeedback;
    if (!turnHandle.requiresApprovedGoalClosure) return undefined;
    if (input.options?.allowInformationalReply && !turnHandle.completionDeclaration
      && turnHandle.policyBudget.toolCalls === toolCallsAtEntry) return undefined;
    const incomplete = await approvedGoalContinuation.closingCheck();
    if (incomplete) return incomplete;
    const restorationFeedback = await captureRestorationFeedback(turnHandle.completionDeclaration);
    if (restorationFeedback) {
      turnHandle.completionDeclaration = null;
      return `${restorationFeedback}\nThe previous completion declaration is no longer active; call turn_complete again.`;
    }
    return approvedGoalContinuation.closingCheck(() => {
      if (preparedRuntime.approvedExecution) assertApprovedExecutionCurrent(executionScopeId, input.agentId, preparedRuntime.approvedExecution.offer);
      const mission = preparedRuntime.approvedExecution?.investigation?.mission;
      if (!mission || !['completed', 'budget_paused'].includes(turnHandle.completionDeclaration?.disposition ?? '')) return;
      guards.validateCompletion({ profileId: input.agentId, completionContract: 'investigation-report', investigationMission: mission,
        sessionId: executionScopeId, turnId: turnHandle.turnId, disposition: turnHandle.completionDeclaration!.disposition,
        evidenceRefs: turnHandle.completionDeclaration!.evidenceRefs, budgetEvidence: completionBudgetEvidence(turnHandle),
        finalAnswerText: message.content.filter(block => block.type === 'text').map(block => block.text).join('').trim() });
    });
  };
}
