import type { CommandDefinition } from '@shared/types/command';
import { storageAdapter } from '../../sessions/StorageAdapter';

export const usageCommand: CommandDefinition = {
  id: 'usage',
  name: 'usage',
  description: 'Show persisted run and live usage availability for the current session',
  category: 'debug',

  async execute(_args, ctx) {
    const sessionId = ctx.sessionId;
    if (!sessionId) {
      return {
        success: true,
        message: 'No active session. Open or create a session to track usage.',
      };
    }

    const runs = storageAdapter.listRuns(sessionId);
    if (runs.length === 0) {
      return {
        success: true,
        message: `Session ${sessionId} has no runs yet.`,
      };
    }

    const byStatus = new Map<string, number>();
    for (const run of runs) {
      byStatus.set(run.status, (byStatus.get(run.status) ?? 0) + 1);
    }
    const statusLines = [...byStatus.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => `  ${status}: ${count}`);
    const lines = [
      `Session: ${sessionId}`,
      `Runs: ${runs.length}`,
      'By status:',
      ...statusLines,
      '',
      'Current-run token usage is available through workflow:getRunUsage while a run is active.',
      'Historical token and API-call counts are not persisted per run yet.',
    ];
    return { success: true, message: lines.join('\n') };
  },
};
