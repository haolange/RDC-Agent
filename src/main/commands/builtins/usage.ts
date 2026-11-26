import { sessionRecordStore } from '../../sessions/store/sessionStores';
import { commandText } from '../commandI18n';
import type { CommandDefinition } from '../CommandRegistry';

export const usageCommand: CommandDefinition = {
  id: 'usage',
  name: 'usage',
  descriptionKey: 'usage.description',
  category: 'debug',

  async execute(_args, ctx) {
    const sessionId = ctx.sessionId;
    if (!sessionId) return { success: true, message: commandText('common.noSession') };
    const runs = sessionRecordStore.listRuns(sessionId);
    if (runs.length === 0) return { success: true, message: commandText('cost.noRuns') };
    const byStatus = new Map<string, number>();
    for (const run of runs) byStatus.set(run.status, (byStatus.get(run.status) ?? 0) + 1);
    const statusLines = [...byStatus.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([status, count]) => `  ${status}: ${count}`);
    const lines = [
      commandText('usage.session', { sessionId }),
      commandText('usage.runs', { count: runs.length }),
      commandText('usage.byStatus'),
      ...statusLines,
      '',
      commandText('usage.liveNote'),
    ];
    return { success: true, message: lines.join('\n') };
  },
};
