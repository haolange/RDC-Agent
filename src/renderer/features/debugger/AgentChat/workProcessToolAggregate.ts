import type { WorkProcessRow, WorkProcessRowStatus, WorkProcessToolGroupKind } from './workProcessTypes';

const TOOL_AGGREGATE_THRESHOLD = 3;

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
  if (/^read_file$|^read$|^memory_read$|^skill_read$|^rdx_context$/.test(name)) return 'read';
  if (/^bash$|^shell$/.test(name)) return 'ran';
  if (/^glob$|^task_list$|^skills$|^mcp$/.test(name)) return 'listed';
  if (/^grep$|^web_search$|^web_fetch$|^memory_search$|^tool_search$/.test(name)) return 'searched';
  return KIND_TO_BUCKET[row.groupKind] ?? 'other';
}

function deriveStatus(rows: ToolRow[]): WorkProcessRowStatus {
  if (rows.some((row) => row.status === 'error')) return 'error';
  if (rows.some((row) => row.status === 'running')) return 'running';
  if (rows.some((row) => row.status === 'pending')) return 'pending';
  return 'complete';
}

function formatDuration(rows: ToolRow[]): string {
  return rows.map((row) => row.duration).find(Boolean) ?? '';
}

/**
 * Build a Chinese natural-language aggregate summary.
 * Locale mapping happens in workProcessUseLabel / i18n (EN equivalents).
 */
export function buildToolAggregateSummary(tools: ToolRow[]): string {
  const counts: Record<AggregateBucket, number> = {
    created: 0,
    edited: 0,
    deleted: 0,
    read: 0,
    ran: 0,
    searched: 0,
    listed: 0,
    other: 0,
  };
  for (const tool of tools) {
    counts[classifyTool(tool)] += 1;
  }

  const parts: string[] = [];
  if (counts.created > 0) {
    parts.push(counts.created === 1 ? '创建了 1 个文件' : `创建了 ${counts.created} 个文件`);
  }
  if (counts.edited > 0) {
    parts.push(counts.edited === 1 ? '编辑了 1 个文件' : `编辑了 ${counts.edited} 个文件`);
  }
  if (counts.deleted > 0) {
    parts.push(counts.deleted === 1 ? '删除了 1 个文件' : `删除了 ${counts.deleted} 个文件`);
  }
  if (counts.read > 0) {
    parts.push(counts.read === 1 ? '读取了 1 个文件' : `读取了 ${counts.read} 个文件`);
  }
  if (counts.ran > 0) {
    parts.push(counts.ran === 1 ? '运行了 1 条命令' : `运行了 ${counts.ran} 条命令`);
  }
  if (counts.searched > 0) {
    parts.push(counts.searched === 1 ? '搜索了 1 次' : `搜索了 ${counts.searched} 次`);
  }
  if (counts.listed > 0) {
    parts.push(counts.listed === 1 ? '列出了 1 项' : `列出了 ${counts.listed} 项`);
  }
  if (counts.other > 0) {
    parts.push(counts.other === 1 ? '使用了 1 个工具' : `使用了 ${counts.other} 个工具`);
  }
  return parts.join('，') || `使用了 ${tools.length} 个工具`;
}

/**
 * Hybrid tool disclosure: ≤2 tools stay flat; ≥3 consecutive tools become one aggregate row.
 * Non-tool rows (userInput / approval / …) flush any pending tools and pass through.
 */
export function aggregateSectionSteps(steps: WorkProcessRow[]): WorkProcessRow[] {
  const output: WorkProcessRow[] = [];
  let pendingTools: ToolRow[] = [];

  const flushTools = () => {
    if (pendingTools.length === 0) return;
    if (pendingTools.length < TOOL_AGGREGATE_THRESHOLD) {
      output.push(...pendingTools);
    } else {
      output.push({
        type: 'toolAggregate',
        id: `tool-agg-${pendingTools[0].id}`,
        status: deriveStatus(pendingTools),
        summary: buildToolAggregateSummary(pendingTools),
        duration: formatDuration(pendingTools),
        children: pendingTools,
      });
    }
    pendingTools = [];
  };

  for (const step of steps) {
    if (step.type === 'tool') {
      pendingTools.push(step);
      continue;
    }
    flushTools();
    output.push(step);
  }
  flushTools();
  return output;
}
