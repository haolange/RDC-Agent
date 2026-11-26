import { expect, it } from 'vitest';
import { countFailedActions, countWorkActions } from './workProcessSectionModel';
import type { WorkProcessRow } from './workProcessTypes';

it('counts actions without counting model prose as work', () => {
  const rows = [
    { type: 'output', id: 'status', text: 'Checking replay', phase: 'commentary', status: 'complete', duration: '' },
    { type: 'tool', id: 'probe', status: 'complete', duration: '' },
  ] as WorkProcessRow[];
  expect(countWorkActions(rows)).toBe(1);
});

it('counts each failed action once, inside steps and groups, and not declined approvals', () => {
  const tool = (id: string, status: string) => ({ type: 'tool', id, status, duration: '' });
  const rows = [
    tool('read', 'error'),
    { ...tool('images', 'complete'), imageCalls: [tool('a', 'complete'), tool('b', 'error'), tool('c', 'error')] },
    {
      type: 'webGroup',
      id: 'pages',
      status: 'complete',
      members: [tool('p1', 'error'), tool('p2', 'complete')],
      pages: [],
      duration: '',
    },
    { type: 'approval', id: 'declined', status: 'error', duration: '' },
    {
      type: 'section',
      id: 'step',
      status: 'error',
      visibleSteps: [tool('nested', 'error'), tool('ok', 'complete')],
      steps: [],
    },
  ] as unknown as WorkProcessRow[];
  expect(countFailedActions(rows)).toBe(5);
});
