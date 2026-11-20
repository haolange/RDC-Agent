// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { translate } from '../../i18n/messages';
import { firstTrackEvent, isTrackActivity } from './workProcessTrack';
import { WorkProcessRailIcon, WorkProcessTrackContext } from './WorkProcessRailIcon';
import { createToolRowForPresentation } from './workProcessToolRows';
import { buildWorkProcessPresentation } from './workProcessTracePresentation';
import type { WorkProcessRow } from './workProcessTypes';
import type { ConversationToolCall } from '@shared/types/conversation';

const t = (key: import('../../i18n/messages').TranslationKey, params?: Record<string, string | number>) => translate('zh-CN', key, params);

const tool = (id: string, status: 'running' | 'pending' | 'error' | 'complete' = 'complete') => createToolRowForPresentation({
  id, toolName: 'read_file', status, startedAt: 1,
}, t) as Extract<WorkProcessRow, { type: 'tool' }>;
const section = (id: string, steps: WorkProcessRow[]): Extract<WorkProcessRow, { type: 'section' }> => ({
  type: 'section', id, loopId: id, status: 'running',
  steps, visibleSteps: steps, stepCount: steps.length, duration: '',
});
it('preserves pending delegation until execution starts instead of creating a running node', () => {
  const presentation = buildWorkProcessPresentation({ status: 'running', updatedAt: 1, blocks: [{
    id: 'delegation-loop', kind: 'llm_turn', title: 'Loop', status: 'running', startedAt: 1,
    toolCalls: [{ id: 'queued-child', toolName: 'subagent', status: 'pending', startedAt: 1,
      delegation: { profile: 'general', task: 'Review', mode: 'wait' } }],
  }] }, t);
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
  }] }, t);
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
  }] }, t).rows[0] as Extract<WorkProcessRow, { type: 'section' }>;
  expect(project().visibleSteps.map((row) => row.id)).toEqual(calls.slice(0, 8).map((call) => call.id));
  calls[8] = { ...calls[8], status: 'running', executionStartedAt: 4 };
  expect(project().visibleSteps).toHaveLength(9);
  calls[8] = { ...calls[8], status: 'complete', completedAt: 5 };
  expect(project().visibleSteps).toHaveLength(1);
  expect(project().visibleSteps[0].type).toBe('toolAggregate');
});
it('finds the first visible event through silent model turns without changing order', () => {
  const rows = [section('a', []), section('b', [tool('first'), tool('second')]), section('c', [tool('third')])];
  expect(firstTrackEvent(rows)).toBe('b');
  expect(rows[1].visibleSteps.map(row => row.id)).toEqual(['first', 'second']);
  expect(firstTrackEvent([section('acted', [tool('first')])])).toBe('acted');
  expect(firstTrackEvent([])).toBeUndefined();
});

it('keeps started details stable during streaming and excludes future calls while retaining pre-start errors', () => {
  const presentation = buildWorkProcessPresentation({ status: 'running', updatedAt: 10, blocks: [{
    id: 'loop', kind: 'llm_turn', title: 'Loop', status: 'running', startedAt: 1,
    items: [{ kind: 'thinking', status: 'streaming', displayOrder: 1,
      providerOutputRef: { protocol: 'test', providerBlockKey: 'reasoning', contentIndex: 0 },
      thinking: { kind: 'raw', source: 'anthropic-thinking', text: 'Still reasoning', visibility: 'raw-collapsed' } }],
    toolCalls: [
      { id: 'running', toolName: 'read_file', status: 'running', startedAt: 1, executionStartedAt: 8, displayOrder: 2, argsPreview: '{"file_path":"actual.txt"}' },
      { id: 'future', toolName: 'read_file', status: 'pending', startedAt: 1, displayOrder: 3 },
      { id: 'denied', toolName: 'shell', status: 'error', startedAt: 1, completedAt: 10, displayOrder: 4, error: 'Permission denied' },
    ],
  }] }, t);
  const row = presentation.rows.find((entry) => entry.type === 'section');
  if (row?.type !== 'section') throw new Error('expected section');
  expect(row.steps.map((entry) => entry.id)).toEqual(['loop:thinking:reasoning:0', 'running', 'denied']);
  const [, running, denied] = row.steps;
  expect(JSON.stringify(running)).toContain('actual.txt');
  expect(denied.duration).toBe('');
});
it('gives silent tool sections a node without giving each tool another node', () => {
  const rows: WorkProcessRow[] = [section('silent', [tool('first')]), tool('first'), tool('second'), section('new', [tool('third')])];
  const html = renderToStaticMarkup(createElement(WorkProcessTrackContext.Provider, {
    value: 'silent', children: rows.map(row => createElement(WorkProcessRailIcon, { key: row.id, row })),
  }));
  const document = new DOMParser().parseFromString(html, 'text/html');
  expect(document.querySelector('[data-work-anchor="silent"]')).not.toBeNull();
  expect(document.querySelectorAll('[data-work-node="structure"]')).toHaveLength(2);
  expect(document.querySelector('[data-work-anchor="second"] [class*="marker"]')).toBeNull();
});
it('counts real parallel execution despite another child error and excludes approval waits', () => {
  const wait = tool('wait', 'running');
  wait.approval = { status: 'pending', verb: 'Waiting', message: '', metaLines: [] };
  expect([tool('error', 'error'), tool('a', 'running'), tool('b', 'running'), tool('pending', 'pending'), wait].filter(isTrackActivity)).toHaveLength(2);
  expect(isTrackActivity(section('settled', [tool('done')]))).toBe(false);
  expect(isTrackActivity(section('tools', [tool('running', 'running')]))).toBe(true);
  expect(isTrackActivity(section('approval', [wait]))).toBe(false);
});

it('interleaves task snapshots and tools by first visible order even with equal timestamps', () => {
  const presentation = buildWorkProcessPresentation({ status: 'running', updatedAt: 5, blocks: [
    { id: 'loop', kind: 'llm_turn', title: 'Loop', status: 'running', startedAt: 1, toolCalls: [
      { id: 'read', toolName: 'read_file', status: 'complete', startedAt: 5, executionStartedAt: 5, displayOrder: 2 },
      { id: 'shell', toolName: 'shell', status: 'running', startedAt: 5, executionStartedAt: 5, displayOrder: 4 },
    ] },
    { id: 'created', parentLoopId: 'loop', displayOrder: 1, kind: 'task_snapshot', title: 'Tasks', status: 'complete',
      startedAt: 5, toolCalls: [], taskSnapshot: { change: 'created', completed: 0, total: 0, items: [] } },
    { id: 'updated', parentLoopId: 'loop', displayOrder: 3, kind: 'task_snapshot', title: 'Tasks', status: 'complete',
      startedAt: 5, toolCalls: [], taskSnapshot: { change: 'updated', completed: 0, total: 0, items: [] } },
  ] }, t);
  const row = presentation.rows[0] as Extract<WorkProcessRow, { type: 'section' }>;
  expect(row.visibleSteps.map((step) => step.id)).toEqual(['created', 'read', 'updated', 'shell']);
});

it('keeps a question between its earlier text and later tool in the owning group', () => {
  const presentation = buildWorkProcessPresentation({ status: 'running', updatedAt: 5, blocks: [
    { id: 'loop', kind: 'llm_turn', title: 'Loop', status: 'running', startedAt: 1,
      items: [{ kind: 'text', providerOutputRef: { protocol: 'test', providerBlockKey: 'text', contentIndex: 0 },
        text: 'Before', phase: 'commentary', status: 'complete', displayOrder: 1 }],
      toolCalls: [{ id: 'read', toolName: 'read_file', status: 'complete', startedAt: 2, displayOrder: 3 }] },
    { id: 'question', kind: 'user_input', parentLoopId: 'loop', title: 'Question', status: 'running', startedAt: 2,
      toolCalls: [{ id: 'ask', toolName: 'ask_user', status: 'running', startedAt: 2, displayOrder: 2,
        userInputQuestions: [{ questionId: 'q', prompt: 'Proceed?', options: [], allowFreeform: true }] }] },
  ] }, t);
  const row = presentation.rows[0] as Extract<WorkProcessRow, { type: 'section' }>;
  expect(row.visibleSteps.map((step) => step.id)).toEqual(['loop:output:0', 'ask', 'read']);
  expect(isTrackActivity(row)).toBe(false);
});

it('keeps the group active while a hidden task lifecycle tool is executing', () => {
  const row = buildWorkProcessPresentation({ status: 'running', updatedAt: 2, blocks: [
    { id: 'loop', kind: 'llm_turn', title: 'Loop', status: 'running', startedAt: 1,
      toolCalls: [{ id: 'create', toolName: 'task_create', status: 'running', startedAt: 1, executionStartedAt: 1 }] },
    { id: 'snapshot', kind: 'task_snapshot', parentLoopId: 'loop', title: 'Tasks', status: 'complete', startedAt: 2,
      toolCalls: [], taskSnapshot: { change: 'created', completed: 0, total: 0, items: [] } },
  ] }, t).rows[0] as Extract<WorkProcessRow, { type: 'section' }>;
  expect(row.visibleSteps.map((step) => step.id)).toEqual(['snapshot']);
  expect(isTrackActivity(row)).toBe(true);
});
