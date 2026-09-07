import type { WorkProcessRow } from './workProcessPresentation';

export type ToolRowModel = Extract<WorkProcessRow, { type: 'tool' }>;
