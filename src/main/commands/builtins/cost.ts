import type { CommandDefinition } from '@shared/types/command';
import { storageAdapter } from '../../sessions/StorageAdapter';

export const costCommand: CommandDefinition = {
  id: 'cost',
  name: 'cost',
  description: 'Show persisted run statistics and cost availability for the current session',
  category: 'debug',

  async execute(_args, ctx) {
    const sessionId = ctx.sessionId;
    if (!sessionId) {
      return {
        success: true,
        message: 'No active session. Open or create a session to track cost.',
      };
    }

    const runs = storageAdapter.listRuns(sessionId);
    if (runs.length === 0) {
      return {
        success: true,
        message: `Session ${sessionId} has no runs yet.`,
      };
    }

    const completed = runs.filter((run) => run.status === 'completed').length;
    const failed = runs.filter((run) => run.status === 'failed').length;
    const active = runs.filter((run) => ['queued', 'planning', 'awaiting_input', 'awaiting_approval', 'running', 'stopping'].includes(run.status)).length;
    const lastRun = runs[0];
    const lines = [
      `Session: ${sessionId}`,
      `Runs: ${runs.length} total, ${completed} completed, ${failed} failed, ${active} active`,
      `Last run: ${lastRun.runId} (${lastRun.status}) started ${new Date(lastRun.startedAt).toISOString()}`,
      '',
      'Token totals and estimated cost are projected live during active runs.',
      'Historical per-run token cost is not persisted yet, so this command does not fabricate a total.',
    ];
    return { success: true, message: lines.join('\n') };
  },
};
