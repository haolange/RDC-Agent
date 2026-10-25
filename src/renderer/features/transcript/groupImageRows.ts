import type { WorkProcessRow } from './workProcessTypes';

type ToolRow = Extract<WorkProcessRow, { type: 'tool' }>;
const eligible = (row: WorkProcessRow): row is ToolRow => row.type === 'tool'
  && row.toolName === 'read_image' && row.status === 'complete';

/** Presentation only: preserve every receipt and stop at every narrative boundary. */
export function groupImageRows(rows: WorkProcessRow[]): WorkProcessRow[] {
  const output: WorkProcessRow[] = [];
  let images: ToolRow[] = [];
  const flush = () => {
    if (!images.length) return;
    output.push({ ...images[0], imageCalls: images, duration: images.length === 1 ? images[0].duration : '' });
    images = [];
  };
  for (const row of rows) {
    if (eligible(row)) images.push(...(row.imageCalls ?? [row]));
    else { flush(); output.push(row); }
  }
  flush();
  return output;
}
