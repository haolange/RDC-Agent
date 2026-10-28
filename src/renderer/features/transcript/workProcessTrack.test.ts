// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { firstTrackEvent, isTrackActivity, runningToolCount } from './workProcessTrack';
import { WorkProcessRailIcon, WorkProcessTrackContext } from './WorkProcessRailIcon';
import { createToolRowForPresentation } from './workProcessToolRows';
import type { WorkProcessRow } from './workProcessTypes';
import { buildWorkProcessPresentation } from './workProcessTracePresentation';

const tool = (id: string, status: 'running' | 'pending' | 'error' | 'complete' = 'complete') => createToolRowForPresentation({
  id, toolName: 'read_file', status, startedAt: 1,
}) as Extract<WorkProcessRow, { type: 'tool' }>;
const section = (id: string, steps: WorkProcessRow[], proseText = ''): Extract<WorkProcessRow, { type: 'section' }> => ({
  type: 'section', id, loopId: id, status: 'running', proseText, proseStreaming: false,
  thinkingPreview: '', thinkingLabel: '', thinkingExpandable: false, thinkingOpenByDefault: false,
  steps, visibleSteps: steps, stepCount: steps.length, stepsDisclosure: 'visible', duration: '', defaultOpen: false,
});
it('preserves pending delegation until execution starts instead of creating a running node', () => {
  const presentation = buildWorkProcessPresentation({ status: 'running', updatedAt: 1, blocks: [{
    id: 'delegation-loop', kind: 'llm_turn', title: 'Loop', status: 'running', startedAt: 1,
    toolCalls: [{ id: 'queued-child', toolName: 'subagent', status: 'pending', startedAt: 1,
      delegation: { profile: 'general', task: 'Review', mode: 'wait' } }],
  }] });
  const first = presentation.rows[0];
  const child = first.type === 'section' ? first.steps[0] : first;
  expect(child).toMatchObject({ type: 'subagent', status: 'pending' });
  expect(isTrackActivity(child)).toBe(false);
});
it('finds the first visible event through silent model turns without changing order', () => {
  const rows = [section('a', []), section('b', [tool('first'), tool('second')]), section('c', [tool('third')])];
  expect(firstTrackEvent(rows)).toBe('first');
  expect(rows[1].visibleSteps.map(row => row.id)).toEqual(['first', 'second']);
  expect(firstTrackEvent([section('narrative', [tool('first')], 'Start here')])).toBe('narrative');
  expect(firstTrackEvent([])).toBeUndefined();
});
it('suppresses silent-section nodes and retains later narration and the first tool', () => {
  const rows: WorkProcessRow[] = [section('silent', [tool('first')]), tool('first'), tool('second'), section('new', [], 'Next step')];
  const html = renderToStaticMarkup(createElement(WorkProcessTrackContext.Provider, {
    value: 'first', children: rows.map(row => createElement(WorkProcessRailIcon, { key: row.id, row })),
  }));
  const document = new DOMParser().parseFromString(html, 'text/html');
  expect(document.querySelector('[data-work-anchor="silent"]')).toBeNull();
  expect(document.querySelectorAll('[data-work-node="structure"]')).toHaveLength(2);
  expect(document.querySelector('[data-work-anchor="second"] [class*="marker"]')).toBeNull();
});
it('counts real parallel execution despite another child error and excludes approval waits', () => {
  const wait = tool('wait', 'running');
  wait.approval = { status: 'pending', verb: 'Waiting', message: '', metaLines: [] };
  expect(runningToolCount([tool('error', 'error'), tool('a', 'running'), tool('b', 'running'), tool('pending', 'pending'), wait])).toBe(2);
  expect(isTrackActivity({ ...section('settled-thinking', []), thinkingStatus: 'complete' })).toBe(false);
  expect(isTrackActivity({ ...section('stream', []), proseStreaming: true })).toBe(true);
  expect(isTrackActivity({ ...section('thinking', []), thinkingStatus: 'streaming' })).toBe(true);
});
