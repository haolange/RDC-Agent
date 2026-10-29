// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { firstTrackEvent, isTrackActivity } from './workProcessTrack';
import { WorkProcessRailIcon, WorkProcessTrackContext } from './WorkProcessRailIcon';
import { createToolRowForPresentation } from './workProcessToolRows';
import type { WorkProcessRow } from './workProcessTypes';
import { buildWorkProcessPresentation } from './workProcessTracePresentation';
import type { ConversationToolCall } from '@shared/types/conversation';

const tool = (id: string, status: 'running' | 'pending' | 'error' | 'complete' = 'complete') => createToolRowForPresentation({
  id, toolName: 'read_file', status, startedAt: 1,
}) as Extract<WorkProcessRow, { type: 'tool' }>;
const section = (id: string, steps: WorkProcessRow[], proseText = ''): Extract<WorkProcessRow, { type: 'section' }> => ({
  type: 'section', id, loopId: id, status: 'running', proseText, proseStreaming: false,
  thinkingPreview: '', thinkingLabel: '', thinkingExpandable: false, thinkingOpenByDefault: false,
  steps, visibleSteps: steps, stepCount: steps.length, duration: '', defaultOpen: false,
});
it('preserves pending delegation until execution starts instead of creating a running node', () => {
  const presentation = buildWorkProcessPresentation({ status: 'running', updatedAt: 1, blocks: [{
    id: 'delegation-loop', kind: 'llm_turn', title: 'Loop', status: 'running', startedAt: 1,
    toolCalls: [{ id: 'queued-child', toolName: 'subagent', status: 'pending', startedAt: 1,
      delegation: { profile: 'general', task: 'Review', mode: 'wait' } }],
  }] });
  expect(presentation.rows).toHaveLength(0);
});
it('retains task approval and pre-execution errors while suppressing successful duplicate task receipts', () => {
  const presentation = buildWorkProcessPresentation({ status: 'running', updatedAt: 4, blocks: [{
    id: 'task-negative', kind: 'llm_turn', title: 'Loop', status: 'running', startedAt: 1,
    toolCalls: [
      { id: 'failed-task', toolName: 'task_update', status: 'error', startedAt: 1, error: 'Unknown task' },
      { id: 'task-approval', toolName: 'task_create', status: 'pending', startedAt: 1,
        approval: { approvalId: 'task-approval-request', status: 'pending', reason: 'Review required' } },
      { id: 'done-task', toolName: 'task_create', status: 'complete', startedAt: 1, executionStartedAt: 2, completedAt: 3 },
    ],
  }] });
  const row = presentation.rows[0] as Extract<WorkProcessRow, { type: 'section' }>;
  expect(row.visibleSteps.map((step) => step.id)).toEqual(['failed-task', 'task-approval']);
  expect(row.visibleSteps.some(isTrackActivity)).toBe(false);
  expect(row.visibleSteps[0].duration).toBe('');
});
it('does not aggregate eight completed calls while a hidden ninth declaration still awaits execution', () => {
  const calls: ConversationToolCall[] = Array.from({ length: 9 }, (_, index) => ({
    id: `boundary-${index}`, toolName: 'read_file', status: index === 8 ? 'pending' : 'complete',
    startedAt: 1, ...(index < 8 ? { executionStartedAt: 2, completedAt: 3 } : {}),
  }));
  const project = () => buildWorkProcessPresentation({ status: 'running', updatedAt: 4, blocks: [{
    id: 'boundary-loop', kind: 'llm_turn', title: 'Loop', status: 'running', startedAt: 1, toolCalls: calls,
  }] }).rows[0] as Extract<WorkProcessRow, { type: 'section' }>;
  expect(project().visibleSteps.map((row) => row.id)).toEqual(calls.slice(0, 8).map((call) => call.id));
  calls[8] = { ...calls[8], status: 'running', executionStartedAt: 4 };
  expect(project().visibleSteps).toHaveLength(9);
  calls[8] = { ...calls[8], status: 'complete', completedAt: 5 };
  expect(project().visibleSteps).toHaveLength(1);
  expect(project().visibleSteps[0].type).toBe('toolAggregate');
});
it('finds the first visible event through silent model turns without changing order', () => {
  const rows = [section('a', []), section('b', [tool('first'), tool('second')]), section('c', [tool('third')])];
  expect(firstTrackEvent(rows)).toBe('first');
  expect(rows[1].visibleSteps.map(row => row.id)).toEqual(['first', 'second']);
  expect(firstTrackEvent([section('narrative', [tool('first')], 'Start here')])).toBe('narrative');
  expect(firstTrackEvent([])).toBeUndefined();
});

it('keeps started details stable during streaming and excludes future calls while retaining pre-start errors', () => {
  const presentation = buildWorkProcessPresentation({ status: 'running', updatedAt: 10, blocks: [{
    id: 'loop', kind: 'llm_turn', title: 'Loop', status: 'running', startedAt: 1,
    thinking: { kind: 'raw', source: 'anthropic-thinking', text: 'Still reasoning', visibility: 'raw-collapsed' }, thinkingStatus: 'streaming',
    toolCalls: [
      { id: 'running', toolName: 'read_file', status: 'running', startedAt: 1, executionStartedAt: 8, argsPreview: '{"file_path":"actual.txt"}' },
      { id: 'future', toolName: 'read_file', status: 'pending', startedAt: 1 },
      { id: 'denied', toolName: 'shell', status: 'error', startedAt: 1, completedAt: 10, error: 'Permission denied' },
    ],
  }] });
  const row = presentation.rows.find((entry) => entry.type === 'section');
  expect(row?.type === 'section' && row.steps.map((entry) => entry.id)).toEqual(['running', 'denied']);
  expect(row?.type === 'section' && JSON.stringify(row.steps[0])).toContain('actual.txt');
  expect(row?.type === 'section' && row.steps[1].duration).toBe('');
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
  expect([tool('error', 'error'), tool('a', 'running'), tool('b', 'running'), tool('pending', 'pending'), wait].filter(isTrackActivity)).toHaveLength(2);
  expect(isTrackActivity({ ...section('settled-thinking', []), thinkingStatus: 'complete' })).toBe(false);
  expect(isTrackActivity({ ...section('stream', []), proseStreaming: true })).toBe(true);
  expect(isTrackActivity({ ...section('thinking', []), thinkingStatus: 'streaming' })).toBe(true);
});
