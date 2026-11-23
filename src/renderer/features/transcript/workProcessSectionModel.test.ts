import { expect, it } from 'vitest';
import { countWorkActions } from './workProcessSectionModel';
import type { WorkProcessRow } from './workProcessTypes';

it('counts actions without counting model prose as work', () => {
  const rows = [
    { type: 'output', id: 'status', text: 'Checking replay', phase: 'commentary', status: 'complete', duration: '' },
    { type: 'tool', id: 'probe', status: 'complete', duration: '' },
  ] as WorkProcessRow[];
  expect(countWorkActions(rows)).toBe(1);
});
