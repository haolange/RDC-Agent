import type { Translator } from '../../i18n/messages';
import type { WorkProcessRow, WorkProcessRowStatus, WorkProcessToolGroupKind } from './workProcessTypes';
import { groupImageRows } from './groupImageRows';

const TOOL_AGGREGATE_THRESHOLD = 8;

type ToolRow = Extract<WorkProcessRow, { type: 'tool' }>;

type AggregateBucket =
  | 'created'
  | 'edited'
  | 'deleted'
  | 'read'
  | 'ran'
  | 'searched'
  | 'listed'
  | 'other';

const KIND_TO_BUCKET: Partial<Record<WorkProcessToolGroupKind, AggregateBucket>> = {
  change: 'edited',
  command: 'ran',
  explore: 'read',
  search: 'searched',
  web: 'searched',
  git: 'other',
  memory: 'other',
  task: 'other',
  interaction: 'other',
  collaboration: 'other',
  runtime: 'other',
  mcp: 'other',
  diagnostic: 'other',
};

function classifyTool(row: ToolRow): AggregateBucket {
  const name = row.toolName.trim().toLowerCase().replace(/[.-]/g, '_');
  if (/^write_file$|^write$/.test(name)) return 'created';
  if (/^edit_file$|^notebook_edit$|^edit$/.test(name)) return 'edited';
  if (/^delete_file$|^delete$/.test(name)) return 'deleted';
  if (/^read_file$|^read$|^memory_read$|^skill_read$|^rdc_context$|^rdc_probe$/.test(name)) return 'read';
  if (/^shell$/.test(name)) return 'ran';
  if (/^glob$|^task_list$|^skills$|^mcp$/.test(name)) return 'listed';
  if (/^grep$|^web_search$|^web_fetch$|^memory_search$|^tool_search$/.test(name)) return 'searched';
  return KIND_TO_BUCKET[row.groupKind] ?? 'other';
}

function deriveStatus(rows: ToolRow[]): WorkProcessRowStatus {
  if (rows.some((row) => row.status === 'error')) return 'error';
  if (rows.some((row) => row.status === 'cancelled')) return 'cancelled';
  if (rows.some((row) => row.status === 'skipped')) return 'skipped';
  return 'complete';
}

function formatDuration(rows: ToolRow[]): string {
  return rows.map((row) => row.duration).find(Boolean) ?? '';
}

/**
 * Settled tool disclosure: ≤7 tools stay flat; ≥8 consecutive tools become one aggregate row.
 * Non-tool rows (userInput / approval / …) flush any pending tools and pass through.
 */
export function aggregateSectionSteps(steps: WorkProcessRow[], t: Translator, settled = true): WorkProcessRow[] {
  const output: WorkProcessRow[] = [];
  let pendingTools: ToolRow[] = [];

  const flushTools = () => {
    if (pendingTools.length === 0) return;
    if (!settled || pendingTools.length < TOOL_AGGREGATE_THRESHOLD || pendingTools.some((row) => row.status === 'running' || row.status === 'pending')) {
      output.push(...pendingTools);
    } else {
      output.push({
        type: 'toolAggregate',
        id: `tool-agg-${pendingTools[0].id}`,
        status: deriveStatus(pendingTools),
        summary: buildToolAggregateSummary(pendingTools, t),
        duration: formatDuration(pendingTools),
        children: pendingTools,
      });
    }
    pendingTools = [];
  };

  for (const step of groupImageRows(steps)) {
    if (step.type === 'tool' && !step.imageCalls) {
      pendingTools.push(step);
      continue;
    }
    flushTools();
    output.push(step);
  }
  flushTools();
  return output;
}/** Summarize application-owned counts directly in the selected language. */
export function buildToolAggregateSummary(tools: ToolRow[], t: Translator): string {
  const counts: Record<AggregateBucket, number> = { created: 0, edited: 0, deleted: 0, read: 0, ran: 0, searched: 0, listed: 0, other: 0 };
  for (const tool of tools) counts[classifyTool(tool)] += 1;
  const keys = {
    created: ['chat.workProcessAggregateCreatedOne', 'chat.workProcessAggregateCreatedMany'],
    edited: ['chat.workProcessAggregateEditedOne', 'chat.workProcessAggregateEditedMany'],
    deleted: ['chat.workProcessAggregateDeletedOne', 'chat.workProcessAggregateDeletedMany'],
    read: ['chat.workProcessAggregateReadOne', 'chat.workProcessAggregateReadMany'],
    ran: ['chat.workProcessAggregateRanOne', 'chat.workProcessAggregateRanMany'],
    searched: ['chat.workProcessAggregateSearchedOne', 'chat.workProcessAggregateSearchedMany'],
    listed: ['chat.workProcessAggregateListedOne', 'chat.workProcessAggregateListedMany'],
    other: ['chat.workProcessAggregateUsedOne', 'chat.workProcessAggregateUsedMany'],
  } as const;
  return (Object.keys(counts) as AggregateBucket[]).filter(bucket => counts[bucket] > 0)
    .map(bucket => t(keys[bucket][counts[bucket] === 1 ? 0 : 1], { count: counts[bucket] }))
    .join(t('chat.aggregateSeparator'));
}
