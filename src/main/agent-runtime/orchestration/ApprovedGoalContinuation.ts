import { TaskRegistry, createSessionTaskStore } from '../tasks';
import { investigationArtifactService, type InvestigationArtifactService } from '../../investigation/InvestigationArtifactService';
import { describeOpenInvestigationWork } from '../../investigation/openInvestigationWork';
import { listActiveDelegations } from './DirectTaskTurnLifecycle';
import type { TurnHandle } from './TurnCoordinator';

/** Provide facts about the approved goal without deciding whether the Agent can progress. */
export function createApprovedGoalContinuation(
  turn: TurnHandle, sessionId: string, registry = new TaskRegistry(createSessionTaskStore(sessionId)),
  investigation: InvestigationArtifactService = investigationArtifactService,
): (validate?: () => void) => Promise<string | undefined> {
  const openWork = () => {
    try { return describeOpenInvestigationWork(investigation, sessionId); }
    catch (error) {
      // Reassessment still proceeds; the gap in recorded facts is stated rather than hidden.
      return `\n## Open work you recorded\nRecorded investigation work could not be read: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  const reassessed = new Set<string>();
  let pendingReassessment: { declaration: NonNullable<TurnHandle['completionDeclaration']>; toolCalls: number } | undefined;
  return async (validate) => {
    if (turn.isAborted || turn.pendingHandoff) return undefined;
    if (pendingReassessment) {
      if (turn.completionDeclaration === pendingReassessment.declaration
        && turn.policyBudget.toolCalls > pendingReassessment.toolCalls) {
        // A prior partial cannot describe work performed after it was declared.
        turn.completionDeclaration = null;
      }
      pendingReassessment = undefined;
    }
    const disposition = turn.completionDeclaration?.disposition;
    if (disposition === 'partial' || disposition === 'blocked') {
      // The last remaining request is text-only, so it cannot redeclare completion.
      if (turn.providerLoopBudget && turn.providerLoopBudget.remaining <= 2) return undefined;
      // Background work may legitimately outlive a partial parent response.
      if ((await listActiveDelegations(sessionId)).length) return undefined;
      try { await registry.assertApprovedTasksCompleted(); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.startsWith('TASK_EXECUTION_REQUIREMENTS:')) throw error;
        const incomplete = /^TASK_EXECUTION_REQUIREMENTS: approved Task is not completed: (.+)$/u.exec(message);
        const task = incomplete ? await registry.getTask(incomplete[1]) : null;
        if (incomplete && !task) throw new Error(`Approved Task disappeared during completion check: ${incomplete[1]}`);
        if (turn.isAborted || turn.pendingHandoff || task?.status === 'cancelled') return undefined;
        const key = task ? JSON.stringify([task.id, task.revision, task.currentExecutionId ?? null, task.status]) : message;
        if (reassessed.has(key)) return undefined;
        reassessed.add(key);
        pendingReassessment = { declaration: turn.completionDeclaration!, toolCalls: turn.policyBudget.toolCalls };
        const status = task ? ` Current status: ${task.status}; reason: ${task.statusReason || 'not recorded'}.` : '';
        return `# Approved Goal Reassessment\n${message}${status}\nCompare the unfinished approved work with the actual evidence; an unproved result or a partial Task is not itself a blocker. If a useful, permitted check remains within the approved scope, resume the same Task if needed and perform the next check now; do not stop after merely listing or acknowledging it. If a derived context may have omitted approved work, reread the frozen plan by its verified URI and hash before deciding. Do not repeat an unchanged failed or denied action, expand permissions, reset consumption or extend the deadline. After further tool work, call turn_complete again with the updated result. If no useful permitted work remains, preserve the existing partial or blocked declaration and report the concrete blocker and remaining work accurately.${openWork()}`;
      }
      if (disposition === 'partial' && turn.completionDeclaration?.result?.unresolved.some(item => item.trim())) {
        const references = turn.completionDeclaration.evidenceRefs.map(ref => `${ref.uri}\u0000${ref.hash}`).sort();
        const key = JSON.stringify(['settled-goal', references]);
        if (!reassessed.has(key)) {
          reassessed.add(key);
          pendingReassessment = { declaration: turn.completionDeclaration, toolCalls: turn.policyBudget.toolCalls };
          return '# Approved Goal Reassessment\nThe approved Tasks are settled, but the partial result still lists unresolved work. Compare it with the approved goal and actual evidence. If a useful, permitted action remains within the approved scope, perform it now; do not stop after merely listing it. If no such action remains, retain the partial result and report the concrete blocker. Do not repeat unchanged failures, expand permissions, reset consumption or extend the deadline. After further tool work, declare the updated result again.' + openWork();
        }
      }
      return undefined;
    }
    if (disposition && disposition !== 'completed') {
      if (disposition !== 'budget_paused' || !validate) return undefined;
      try { validate(); return undefined; }
      catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'MISSION_COMPLETION_DENIED') throw error;
        turn.completionDeclaration = null;
        return `# Incomplete Approved Obligation\n${error.message}\nContinue within the approved scope or report the actual blocker; do not reset consumption.`;
      }
    }
    const active = await listActiveDelegations(sessionId);
    let gap: string | undefined;
    if (active.length) {
      gap = `Active delegated executions must be joined before completion: ${active.map(item => item.id).join(', ')}.`;
    } else {
      try { await registry.assertApprovedTasksCompleted(); }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.startsWith('TASK_EXECUTION_REQUIREMENTS:')) throw error;
        const incomplete = /^TASK_EXECUTION_REQUIREMENTS: approved Task is not completed: (.+)$/u.exec(message);
        const task = incomplete ? await registry.getTask(incomplete[1]) : null;
        gap = task && (task.status === 'blocked' || task.status === 'cancelled')
          ? `${message} Current status: ${task.status}; reason: ${task.statusReason || 'not recorded'}.`
          : message;
      }
    }
    if (!gap && !turn.completionDeclaration) {
      gap = 'Declare the approved goal disposition using turn_complete, including the concrete remaining work and reason for a partial or blocked result.';
    }
    if (!gap && validate) {
      try { validate(); }
      catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'MISSION_COMPLETION_DENIED') throw error;
        gap = error.message;
      }
    }
    if (!gap) return undefined;
    const invalidatedCompletion = turn.completionDeclaration?.disposition === 'completed';
    if (invalidatedCompletion) turn.completionDeclaration = null;
    const redeclare = invalidatedCompletion
      ? '\nThe previous completed declaration is no longer active. After addressing the gap, call turn_complete again before the final response.'
      : '';
    return `# Incomplete Approved Obligation\n${gap}${redeclare}\nContinue useful work within the approved scope, or declare an accurate blocked/partial disposition when further work cannot proceed. Do not reset consumption or alter the approved requirement.`;
  };
}
