import { sessionRecordStore } from '../../sessions/store/sessionStores';
import { commandText } from '../commandI18n';
import type { CommandDefinition } from '../CommandRegistry';

const ACTIVE_RUN_STATUSES = ['queued', 'planning', 'awaiting_input', 'awaiting_approval', 'running', 'stopping'];

export const costCommand: CommandDefinition = {
  id: 'cost',
  name: 'cost',
  descriptionKey: 'cost.description',
  category: 'debug',

  async execute(_args, ctx) {
    const sessionId = ctx.sessionId;
    if (!sessionId) return { success: true, message: commandText('common.noSession') };
    const runs = sessionRecordStore.listRuns(sessionId);
    if (runs.length === 0) return { success: true, message: commandText('cost.noRuns') };
    const lastRun = runs[0];
    const lines = [
      commandText('cost.session', { sessionId }),
      commandText('cost.runs', {
        total: runs.length,
        completed: runs.filter((run) => run.status === 'completed').length,
        failed: runs.filter((run) => run.status === 'failed').length,
        active: runs.filter((run) => ACTIVE_RUN_STATUSES.includes(run.status)).length,
      }),
      commandText('cost.lastRun', {
        runId: lastRun.runId,
        status: lastRun.status,
        startedAt: new Date(lastRun.startedAt).toISOString(),
      }),
      '',
      commandText('cost.liveNote'),
      commandText('cost.historyNote'),
    ];
    return { success: true, message: lines.join('\n') };
  },
};
