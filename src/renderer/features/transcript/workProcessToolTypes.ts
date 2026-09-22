import type { WorkProcessRow } from './workProcessTypes';

export type ToolRowModel = Extract<WorkProcessRow, { type: 'tool' }>;
