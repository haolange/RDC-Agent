import type { WorkProcessRow } from './workProcessTypes';

export function countGroupActions(rows: WorkProcessRow[]): number {
  return rows.reduce((total, row) => {
    if (row.type === 'section') return total + row.stepCount;
    if (row.type === 'toolGroup') return total + row.rows.length;
    if (row.type === 'tool' || row.type === 'userInput') return total + 1;
    if (row.type === 'subagent') return total + countGroupActions(row.children);
    return total;
  }, 0);
}

function parseDurationToMs(duration: string): number {
  const msMatch = /^(\d+)ms$/.exec(duration);
  if (msMatch) return Number(msMatch[1]);
  const sMatch = /^([\d.]+)s$/.exec(duration);
  if (sMatch) return Math.round(Number(sMatch[1]) * 1000);
  const mMatch = /^(\d+)m (\d{2})s$/.exec(duration);
  if (mMatch) return Number(mMatch[1]) * 60_000 + Number(mMatch[2]) * 1000;
  return 0;
}

function formatDurationFromMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

export function shouldShowGroupMetrics(rows: WorkProcessRow[], kind?: string): boolean {
  if (kind === 'compaction') return false;
  return countGroupActions(rows) > 0;
}

export function summarizeGroupDuration(rows: WorkProcessRow[]): string {
  const durations: string[] = [];
  const walk = (items: WorkProcessRow[]): void => {
    for (const row of items) {
      if ('duration' in row && row.duration) durations.push(row.duration);
      if (row.type === 'section') walk(row.steps);
      if (row.type === 'toolGroup') walk(row.rows);
      if (row.type === 'subagent') walk(row.children);
    }
  };
  walk(rows);
  if (durations.length === 0) return '';
  const totalMs = durations.reduce((sum, duration) => sum + parseDurationToMs(duration), 0);
  return totalMs > 0 ? formatDurationFromMs(totalMs) : durations[durations.length - 1] ?? '';
}
