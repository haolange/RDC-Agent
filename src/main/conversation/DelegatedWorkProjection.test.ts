import { expect, it } from 'vitest';
import type { AgentEvent } from '@shared/types/agentRuntime';
import { createDelegatedProjectionState, projectDelegatedEvent } from './DelegatedWorkProjection';

const event = (id: string, type: AgentEvent['type'], payload: object, timestamp: number): AgentEvent => ({
  id, type, timestamp, payload: payload as AgentEvent['payload'],
});

it('preserves the host-selected approval method and failure code in child work projection', () => {
  let state = createDelegatedProjectionState();
  state = projectDelegatedEvent(state, event('request', 'approval.requested', {
    approvalId: 'auto-review-child', kind: 'tool', toolCallId: 'child', toolName: 'shell', status: 'pending',
    reviewer: 'auto_review', reviewMethod: 'model',
  }, 1));
  state = projectDelegatedEvent(state, event('answer', 'approval.answered', {
    approvalId: 'auto-review-child', kind: 'tool', toolCallId: 'child', toolName: 'shell', status: 'rejected',
    reviewer: 'auto_review', reviewMethod: 'model', errorCode: 'PERMISSION_REVIEW_TIMEOUT', reason: 'No verdict.',
  }, 2));
  expect(state.trace.blocks.flatMap(block => block.toolCalls).find(call => call.id === 'child')).toMatchObject({
    status: 'error', approval: { reviewMethod: 'model', errorCode: 'PERMISSION_REVIEW_TIMEOUT', status: 'rejected' },
  });
});

it('projects visible loop and tool status while excluding hidden reasoning and credentials', () => {
  let state = createDelegatedProjectionState();
  state = projectDelegatedEvent(state, event('hidden', 'assistant.thinking_delta', {
    thinking: { kind: 'raw', source: 'unknown', visibility: 'hidden', text: 'secret thought' },
  }, 1));
  expect(state.trace.blocks).toHaveLength(0);
  state = projectDelegatedEvent(state, event('delta', 'assistant.delta', { text: 'Checking config.',
    providerOutputRef: { protocol: 'test', providerBlockKey: 'text:0', contentIndex: 0 } }, 2));
  state = projectDelegatedEvent(state, event('requested', 'tool.requested', {
    toolCall: { id: 'read', name: 'read_file', arguments: { path: 'config', password: 'private' } },
  }, 3));
  state = projectDelegatedEvent(state, event('completed', 'tool.completed', {
    toolCallId: 'read', toolName: 'read_file', result: { ok: true, data: { content: 'done' } },
  }, 4));
  const block = state.trace.blocks[0];
  expect(block?.outputItems?.[0].text).toContain('Checking config.');
  expect(block?.result?.text).toBeUndefined();
  expect(block?.thinking).toBeUndefined();
  expect(block?.toolCalls[0]).toMatchObject({ id: 'read', toolName: 'read_file', status: 'complete' });
  expect(block?.toolCalls[0]?.argsPreview).not.toContain('private');
});

it('keeps child text identities, task snapshots and tools in first-visible order', () => {
  let state = createDelegatedProjectionState();
  const ref = (index: number) => ({ protocol: 'test', providerBlockKey: `text:${index}`, contentIndex: index });
  state = projectDelegatedEvent(state, event('text', 'assistant.delta', { text: 'Checking', providerOutputRef: ref(0) }, 1));
  state = projectDelegatedEvent(state, event('task', 'task.created', {
    taskId: 'task', title: 'Inspect', status: 'pending',
  }, 2));
  state = projectDelegatedEvent(state, event('requested', 'tool.requested', {
    toolCall: { id: 'read', name: 'read_file', arguments: {} },
  }, 3));
  state = projectDelegatedEvent(state, event('started', 'tool.started', { toolCallId: 'read', toolName: 'read_file' }, 4));
  state = projectDelegatedEvent(state, event('second', 'assistant.delta', {
    text: 'Details', phase: 'commentary', providerOutputRef: ref(1),
  }, 5));
  const loop = state.trace.blocks.find((block) => block.kind === 'llm_turn')!;
  const task = state.trace.blocks.find((block) => block.kind === 'task_snapshot')!;
  expect(loop.outputItems?.map((item) => item.phase)).toEqual(['commentary', 'commentary']);
  expect([loop.outputItems![0].displayOrder, task.displayOrder, loop.toolCalls[0].displayOrder,
    loop.outputItems![1].displayOrder]).toEqual([1, 2, 3, 4]);
});

it('places tool Hook events on their exact call and keeps unowned diagnostics in order', () => {
  let state = createDelegatedProjectionState();
  for (const [id, timestamp] of [['a', 1], ['b', 2]] as const) {
    state = projectDelegatedEvent(state, event(`start-${id}`, 'tool.started', {
      toolCallId: id, toolName: 'shell.command',
    }, timestamp));
  }
  for (const [id, toolCallId, code, severity] of [
    ['hook-a', 'a', 'hook.completed', 'info'],
    ['hook-b', 'b', 'hook.failed', 'warning'],
    ['hook-c', 'a', 'hook.completed', 'info'],
  ] as const) {
    state = projectDelegatedEvent(state, event(id, 'diagnostic', {
      toolCallId, code, severity, message: `Hook ${id}`,
    }, 3));
  }
  state = projectDelegatedEvent(state, event('lifecycle', 'diagnostic', {
    code: 'hook.completed', severity: 'info', message: 'Lifecycle Hook',
  }, 4));
  const calls = state.trace.blocks.flatMap((block) => block.toolCalls);
  expect(calls.find((call) => call.id === 'a')?.hookDiagnostics?.map((item) => item.id)).toEqual(['hook-a', 'hook-c']);
  expect(calls.find((call) => call.id === 'b')?.hookDiagnostics?.map((item) => item.id)).toEqual(['hook-b']);
  expect(calls.find((call) => call.id === 'b')?.status).toBe('running');
  expect(state.trace.blocks.filter((block) => block.kind === 'diagnostic')).toHaveLength(1);
  expect(state.trace.blocks.at(-1)?.summary).toBe('Lifecycle Hook');
});
