import { formatDurationMs } from './workProcessFormat';
import type { WorkProcessRow, WorkProcessRowStatus } from './workProcessTypes';
import type { AppLanguage } from '@shared/types/settings';

type ToolRow = Extract<WorkProcessRow, { type: 'tool' }>;
type WebGroupRow = Extract<WorkProcessRow, { type: 'webGroup' }>;

const isRead = (row: WorkProcessRow): row is ToolRow =>
  row.type === 'tool' && row.toolName === 'web_fetch' && !row.approval;

function groupStatus(members: ToolRow[]): WorkProcessRowStatus {
  if (members.some((member) => member.status === 'running' || member.status === 'pending')) return 'running';
  // One failed page shows on its own pill; the group failed only when nothing loaded.
  if (members.every((member) => member.status === 'error' || member.status === 'cancelled')) return 'error';
  return 'complete';
}

/** The whole span from the first read starting to the last one ending, not the sum of the reads. */
function groupDuration(members: ToolRow[], language: AppLanguage): string {
  const starts = members.flatMap((member) => (member.startedAt ? [member.startedAt] : []));
  const ends = members.flatMap((member) => (member.completedAt ? [member.completedAt] : []));
  if (!starts.length || ends.length < members.length) return '';
  return formatDurationMs(language, Math.min(...starts), Math.max(...ends));
}

export function webGroup(members: ToolRow[], language: AppLanguage): WebGroupRow {
  return {
    type: 'webGroup',
    id: `web-group-${members[0].id}`,
    status: groupStatus(members),
    members,
    pages: members.flatMap((member) => member.webPages ?? []),
    duration: groupDuration(members, language),
  };
}

/**
 * Presentation only: adjacent web reads inside one step become one card. Any other row between them (thinking,
 * commentary, another tool) ends the run, and every member keeps its own receipt.
 */
export function groupWebRows(rows: WorkProcessRow[], language: AppLanguage): WorkProcessRow[] {
  const output: WorkProcessRow[] = [];
  let reads: ToolRow[] = [];
  const flush = () => {
    if (reads.length === 1) output.push(reads[0]);
    else if (reads.length > 1) output.push(webGroup(reads, language));
    reads = [];
  };
  for (const row of rows) {
    if (isRead(row)) reads.push(row);
    else {
      flush();
      output.push(row);
    }
  }
  flush();
  return output;
}
