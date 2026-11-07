import { TaskRegistry, createSessionTaskStore } from '../tasks';
import { listActiveDelegations } from './DirectTaskTurnLifecycle';
import type { TurnHandle } from './TurnCoordinator';

/** Return a host-owned fact only when an approved goal still has actionable obligations. */
export async function approvedGoalContinuation(turn: TurnHandle, sessionId: string, validate?: () => void): Promise<string | undefined> {
  if (turn.isAborted || turn.pendingHandoff) return undefined;
  const disposition = turn.completionDeclaration?.disposition;
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
    const registry = new TaskRegistry(createSessionTaskStore(sessionId));
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
  // A declaration may have been valid when made but invalidated by later work.
  const invalidatedCompletion = turn.completionDeclaration?.disposition === 'completed';
  if (invalidatedCompletion) turn.completionDeclaration = null;
  const redeclare = invalidatedCompletion
    ? '\nThe previous completed declaration is no longer active. After addressing the gap, call turn_complete again before the final response.'
    : '';
  return `# Incomplete Approved Obligation\n${gap}${redeclare}\nContinue useful work within the approved scope, or declare an accurate blocked/partial disposition when further work cannot proceed. Do not reset consumption or alter the approved requirement.`;
}
