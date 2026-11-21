import { describe, expect, it } from 'vitest';
import { workProcessSectionModel } from './workProcessSectionModel';
import type { WorkProcessRow } from './workProcessTypes';

const thinking: WorkProcessRow = { type: 'thinking', id: 'think', status: 'complete', duration: '', preview: 'Checked the pass',
  label: 'Thought', kind: 'summary', kindLabel: '', visibility: 'summary', thinkingStatus: 'complete', expandable: true, openByDefault: false };
const commentary: WorkProcessRow = { type: 'output', id: 'say', status: 'complete', text: 'Reading the draw', phase: 'commentary', duration: '' };
const answer: WorkProcessRow = { type: 'output', id: 'answer', status: 'complete', text: 'Done', phase: 'final_answer', duration: '' };
const tool = { type: 'tool', id: 'read', status: 'complete', duration: '0.4s' } as WorkProcessRow;
const section = (steps: WorkProcessRow[], status: 'complete' | 'running' = 'complete'): Extract<WorkProcessRow, { type: 'section' }> => ({
  type: 'section', id: 'loop', loopId: 'loop', status, stepCount: steps.filter(step => step.type === 'tool').length,
  duration: '1.2s', steps, visibleSteps: steps,
});

describe('Working step leads', () => {
  it.each([
    ['thinking', [thinking, tool]],
    ['thinking+commentary', [thinking, commentary, tool]],
    ['commentary', [commentary, tool]],
    ['actions', [tool]],
  ] as const)('leads with %s', (lead, steps) => {
    const model = workProcessSectionModel(section([...steps]));
    expect(model.lead).toBe(lead);
    expect(model.actionRows.map(row => row.id)).toEqual(['read']);
  });

  it('keeps answer text in the text list and out of the lead kind', () => {
    const model = workProcessSectionModel(section([thinking, answer]));
    expect(model.lead).toBe('thinking');
    expect(model.leadRows.map(row => row.id)).toEqual(['think', 'answer']);
    expect(model.actionRows).toEqual([]);
  });

  it('lays Task snapshots out with the actions, after the lead', () => {
    const snapshot = { type: 'taskSnapshot', id: 'snap', status: 'complete', change: 'updated', completed: 1, total: 3, items: [], duration: '' } as WorkProcessRow;
    const model = workProcessSectionModel(section([thinking, snapshot]));
    expect(model.lead).toBe('thinking');
    expect(model.actionRows.map(row => row.id)).toEqual(['snap']);
  });
});
