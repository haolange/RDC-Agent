import { TaskRegistry, createSessionTaskStore } from '../tasks';
import {
  investigationArtifactService,
  type InvestigationArtifactService,
} from '../../investigation/InvestigationArtifactService';
import { describeOpenInvestigationWork } from '../../investigation/openInvestigationWork';
import { listActiveDelegations } from './DirectTaskTurnLifecycle';
import type { TurnCompletionDeclaration, TurnHandle } from './TurnCoordinator';

export interface ApprovedGoalContinuation {
  /**
   * Reviews a partial or blocked declaration the moment `turn_complete` records it. The facts about unfinished
   * approved work travel back inside that tool result, so the Agent decides whether to keep working before it
   * writes any reply. A turn therefore ends with one reply, not a reply that the runtime later sends back.
   */
  reviewDeclaration(declaration: TurnCompletionDeclaration): Promise<string | undefined>;
  /** What must still hold before the turn may end: a current declaration and every approved obligation met. */
  closingCheck(validate?: () => void): Promise<string | undefined>;
  /** A host-verified change (a restored capture position) makes the open work worth one fresh review. */
  noteConditionsChanged(note: string): void;
}

/** Provide facts about the approved goal without deciding whether the Agent can progress. */
export function createApprovedGoalContinuation(
  turn: TurnHandle,
  sessionId: string,
  registry = new TaskRegistry(createSessionTaskStore(sessionId)),
  investigation: InvestigationArtifactService = investigationArtifactService,
): ApprovedGoalContinuation {
  const openWork = () => {
    try {
      return describeOpenInvestigationWork(investigation, sessionId);
    } catch (error) {
      // Reassessment still proceeds; the gap in recorded facts is stated rather than hidden.
      return `\n## Open work you recorded\nRecorded investigation work could not be read: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  const reviewed = new Set<string>();
  let conditions = { version: 0, note: '' };
  let reviewedDeclaration: { declaration: TurnCompletionDeclaration; toolCalls: number } | undefined;

  /** The incomplete approved Task, if any; other Task-store failures are not hidden. */
  const incompleteApprovedWork = async (): Promise<{
    message: string;
    task: Awaited<ReturnType<TaskRegistry['getTask']>>;
  } | null> => {
    try {
      await registry.assertApprovedTasksCompleted();
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.startsWith('TASK_EXECUTION_REQUIREMENTS:')) throw error;
      const incomplete = /^TASK_EXECUTION_REQUIREMENTS: approved Task is not completed: (.+)$/u.exec(message);
      const task = incomplete ? await registry.getTask(incomplete[1]) : null;
      if (incomplete && !task)
        throw new Error(`Approved Task disappeared during completion check: ${incomplete[1]}`, { cause: error });
      return { message, task };
    }
  };

  // Re-read after each await: the turn can be aborted or hand off while a review is prepared.
  const turnEnded = (): boolean => turn.isAborted || turn.pendingHandoff !== null;

  const reviewDeclaration: ApprovedGoalContinuation['reviewDeclaration'] = async (declaration) => {
    if (!turn.requiresApprovedGoalClosure || turnEnded()) return undefined;
    if (declaration.disposition !== 'partial' && declaration.disposition !== 'blocked') return undefined;
    // Too little loop budget is left to act on a review; the declaration stands as it is.
    if (turn.providerLoopBudget && turn.providerLoopBudget.remaining <= 2) return undefined;
    // Background work may legitimately outlive a partial parent response.
    if ((await listActiveDelegations(sessionId)).length) return undefined;
    const gap = await incompleteApprovedWork();
    if (gap?.task?.status === 'cancelled' || turnEnded()) return undefined;
    if (!gap && (declaration.disposition !== 'partial' || !declaration.result?.unresolved.length)) return undefined;
    // One review per state of the open work: the same unresolved items and Task state are not reviewed again,
    // however often the Agent rewrites its evidence in between.
    const unresolved = (declaration.result?.unresolved ?? [])
      .map((item) => JSON.stringify([item.gap, item.blocker, item.resumeWhen]))
      .sort();
    const taskState = gap
      ? gap.task
        ? [gap.task.id, gap.task.status, gap.task.statusReason ?? '']
        : gap.message
      : null;
    const key = JSON.stringify([conditions.version, taskState, unresolved]);
    if (reviewed.has(key)) return undefined;
    reviewed.add(key);
    reviewedDeclaration = { declaration, toolCalls: turn.policyBudget.toolCalls };
    const changed = conditions.note ? `${conditions.note}\n` : '';
    const next =
      'If a useful, permitted check remains within the approved scope, perform the next check now and call turn_complete again before your reply; do not stop after merely listing or acknowledging it. Do not repeat an unchanged failed or denied action, expand permissions, reset consumption or extend the deadline. If no useful permitted work remains, write your reply now: this declaration stands, and the reply reports the concrete blocker and remaining work.';
    if (gap) {
      const status = gap.task
        ? ` Current status: ${gap.task.status}; reason: ${gap.task.statusReason || 'not recorded'}.`
        : '';
      return `# Approved Goal Reassessment\n${changed}${gap.message}${status}\nCompare the unfinished approved work with the actual evidence; an unproved result or a partial Task is not itself a blocker. Resume the same Task if the next check needs it. If a derived context may have omitted approved work, reread the frozen plan by its verified URI and hash before deciding. ${next}${openWork()}`;
    }
    return `# Approved Goal Reassessment\n${changed}The approved Tasks are settled, but the partial result still lists unresolved work. Compare it with the approved goal and actual evidence. A completed Task cannot be reopened: the reply states which part each completed Task covers and lists the remaining work. ${next}${openWork()}`;
  };

  const closingCheck: ApprovedGoalContinuation['closingCheck'] = async (validate) => {
    if (turn.isAborted || turn.pendingHandoff) return undefined;
    if (reviewedDeclaration) {
      if (
        turn.completionDeclaration === reviewedDeclaration.declaration &&
        turn.policyBudget.toolCalls > reviewedDeclaration.toolCalls
      ) {
        // A reviewed partial cannot describe work performed after it was declared.
        turn.completionDeclaration = null;
      }
      reviewedDeclaration = undefined;
    }
    const disposition = turn.completionDeclaration?.disposition;
    // Partial and blocked declarations were reviewed when they were recorded.
    if (disposition === 'partial' || disposition === 'blocked') return undefined;
    if (disposition && disposition !== 'completed') {
      if (disposition !== 'budget_paused' || !validate) return undefined;
      try {
        validate();
        return undefined;
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'MISSION_COMPLETION_DENIED') throw error;
        turn.completionDeclaration = null;
        return `# Incomplete Approved Obligation\n${error.message}\nContinue within the approved scope or report the actual blocker; do not reset consumption.`;
      }
    }
    const active = await listActiveDelegations(sessionId);
    let gap: string | undefined;
    if (active.length) {
      gap = `Active delegated executions must be joined before completion: ${active.map((item) => item.id).join(', ')}.`;
    } else {
      const incomplete = await incompleteApprovedWork();
      if (incomplete) {
        const { message, task } = incomplete;
        gap =
          task && (task.status === 'blocked' || task.status === 'cancelled')
            ? `${message} Current status: ${task.status}; reason: ${task.statusReason || 'not recorded'}.`
            : message;
      }
    }
    if (!gap && !turn.completionDeclaration) {
      gap =
        'Declare the approved goal disposition using turn_complete, including the concrete remaining work and reason for a partial or blocked result.';
    }
    if (!gap && validate) {
      try {
        validate();
      } catch (error) {
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

  return {
    reviewDeclaration,
    closingCheck,
    noteConditionsChanged: (note) => {
      conditions = { version: conditions.version + 1, note };
    },
  };
}
