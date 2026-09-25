import { expect, it } from 'vitest';
import type { AgentEvent } from '@shared/types/agentRuntime';
import { createDelegatedProjectionState, projectDelegatedEvent } from './DelegatedWorkProjection';

const event = (id: string, type: AgentEvent['type'], payload: object, timestamp: number): AgentEvent => ({
  id, type, timestamp, payload: payload as AgentEvent['payload'],
});

it('projects visible loop and tool status while excluding hidden reasoning and credentials', () => {
  let state = createDelegatedProjectionState();
  state = projectDelegatedEvent(state, event('hidden', 'assistant.thinking_delta', {
    thinking: { kind: 'raw', source: 'unknown', visibility: 'hidden', text: 'secret thought' },
  }, 1));
  expect(state.trace.blocks).toHaveLength(0);
  state = projectDelegatedEvent(state, event('delta', 'assistant.delta', { text: 'Checking config.' }, 2));
  state = projectDelegatedEvent(state, event('requested', 'tool.requested', {
    toolCall: { id: 'read', name: 'read_file', arguments: { path: 'config', password: 'private' } },
  }, 3));
  state = projectDelegatedEvent(state, event('completed', 'tool.completed', {
    toolCallId: 'read', toolName: 'read_file', result: { ok: true, data: { content: 'done' } },
  }, 4));
  const block = state.trace.blocks[0];
  expect(block?.result?.text).toContain('Checking config.');
  expect(block?.thinking).toBeUndefined();
  expect(block?.toolCalls[0]).toMatchObject({ id: 'read', toolName: 'read_file', status: 'complete' });
  expect(block?.toolCalls[0]?.argsPreview).not.toContain('private');
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
