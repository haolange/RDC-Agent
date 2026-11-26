import { normalizeWebUrl } from '@shared/utils/webUrl';
import { webGroup } from './groupWebRows';
import type { WorkProcessRow } from './workProcessTypes';
import type { AppLanguage } from '@shared/types/settings';

type ToolRow = Extract<WorkProcessRow, { type: 'tool' }>;
type SectionRow = Extract<WorkProcessRow, { type: 'section' }>;

const readMembers = (row: WorkProcessRow | undefined): ToolRow[] | null => {
  if (!row) return null;
  if (row.type === 'webGroup') return row.members;
  if (row.type === 'tool' && row.toolName === 'web_fetch' && !row.approval) return [row];
  return null;
};

const hasLead = (section: SectionRow) =>
  section.visibleSteps.some((step) => step.type === 'thinking' || step.type === 'output');

/**
 * Reads that continue across model steps with nothing visible in between (no thinking, commentary or other tool)
 * join the previous step's read card; a step left empty by that disappears.
 */
export function mergeWebReadsAcrossSteps(rows: WorkProcessRow[], language: AppLanguage): WorkProcessRow[] {
  const output: WorkProcessRow[] = [];
  for (const row of rows) {
    const previous = output.at(-1);
    if (row.type !== 'section' || previous?.type !== 'section' || hasLead(row)) {
      output.push(row);
      continue;
    }
    const tail = readMembers(previous.visibleSteps.at(-1));
    let carried = 0;
    const moving: ToolRow[] = [];
    while (tail && carried < row.visibleSteps.length) {
      const members = readMembers(row.visibleSteps[carried]);
      if (!members) break;
      moving.push(...members);
      carried += 1;
    }
    if (!tail || moving.length === 0) {
      output.push(row);
      continue;
    }
    previous.visibleSteps = [...previous.visibleSteps.slice(0, -1), webGroup([...tail, ...moving], language)];
    const rest = row.visibleSteps.slice(carried);
    if (rest.length > 0) output.push({ ...row, visibleSteps: rest });
  }
  return output;
}

function* toolRows(rows: readonly WorkProcessRow[]): Generator<ToolRow> {
  for (const row of rows) {
    if (row.type === 'tool') yield row;
    else if (row.type === 'section') yield* toolRows(row.visibleSteps);
    else if (row.type === 'webGroup') yield* row.members;
  }
}

/** A search result counts as read when a read in the same turn opened the same page. Rows are shared, so marking derives new ones. */
export function markReadSearchResults(rows: WorkProcessRow[]): WorkProcessRow[] {
  const opened = new Set<string>();
  for (const row of toolRows(rows)) {
    if (row.toolName !== 'web_fetch') continue;
    for (const page of row.webPages ?? []) if (page.url && page.state === 'done') opened.add(normalizeWebUrl(page.url));
  }
  const markTool = (row: ToolRow): ToolRow => {
    if (row.toolName !== 'web_search' || !row.webPages) return row;
    const webPages = row.webPages.map((page) => {
      const read = Boolean(page.url && opened.has(normalizeWebUrl(page.url)));
      return page.read === read ? page : { ...page, read };
    });
    return webPages.every((page, index) => page === row.webPages![index]) ? row : { ...row, webPages };
  };
  const markRows = <T extends WorkProcessRow>(list: T[], mark: (row: T) => T): T[] => {
    const next = list.map(mark);
    return next.every((row, index) => row === list[index]) ? list : next;
  };
  const markRow = (row: WorkProcessRow): WorkProcessRow => {
    if (row.type === 'tool') return markTool(row);
    if (row.type === 'webGroup') {
      const members = markRows(row.members, markTool);
      return members === row.members ? row : { ...row, members };
    }
    if (row.type === 'section') {
      const visibleSteps = markRows(row.visibleSteps, markRow);
      return visibleSteps === row.visibleSteps ? row : { ...row, visibleSteps };
    }
    return row;
  };
  return markRows(rows, markRow);
}
