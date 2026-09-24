import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@shared/types/agentRuntime';

const fixture = vi.hoisted(() => ({ root: '', publish: vi.fn() }));
vi.mock('../sessions/StorageAdapter', () => ({ storageAdapter: {
  readSession: (id: string) => id === 'owner' ? { sessionPath: fixture.root } : null,
} }));
vi.mock('../workflow/debugger/WorkflowProjectionPublisher', () => ({ workflowProjectionPublisher: { publish: fixture.publish } }));
import { delegationTraceStore } from './DelegationTraceStore';

afterEach(() => {
  if (fixture.root) fs.rmSync(fixture.root, { recursive: true, force: true });
  fixture.root = '';
  fixture.publish.mockClear();
});

it('keeps one session-owned delegation record, pages chronological visible steps and rejects stale identity', () => {
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-delegation-trace-'));
  const id = 'child\u0000execution\u00001';
  delegationTraceStore.start('owner', {
    parentToolCallId: 'parent-call', task: 'Inspect config', profile: 'general', mode: 'background',
    executionId: 'execution', generation: 1, taskId: 'task', childSessionId: 'child',
    invocation: JSON.stringify({ task: 'Inspect config', apiKey: 'sk-1234567890123456' }),
    status: 'running', startedAt: 1,
  });
  const tool = (type: AgentEvent['type'], payload: object, timestamp: number): AgentEvent => ({
    id: `event-${timestamp}`, type, timestamp, payload: payload as AgentEvent['payload'],
  });
  delegationTraceStore.event('owner', 'parent-call', id, tool('tool.started', {
    toolCallId: 'read', toolName: 'read_file', args: { path: 'config', password: 'private' },
  }, 2));
  delegationTraceStore.event('owner', 'parent-call', 'stale', tool('diagnostic', {
    code: 'IGNORED', severity: 'error', message: 'stale',
  }, 3));
  delegationTraceStore.event('owner', 'parent-call', id, tool('tool.completed', {
    toolCallId: 'read', toolName: 'read_file', result: { ok: true, data: { content: 'done' } },
  }, 4));
  delegationTraceStore.event('owner', 'parent-call', id, tool('diagnostic', {
    code: 'CHECK', severity: 'error', message: 'warning',
  }, 5));
  delegationTraceStore.event('owner', 'parent-call', id, tool('tool.started', {
    toolCallId: 'large', toolName: 'shell', args: { command: 'inspect' },
  }, 6));
  delegationTraceStore.event('owner', 'parent-call', id, tool('tool.completed', {
    toolCallId: 'large', toolName: 'shell', result: { ok: true, data: { content: 'x'.repeat(40_000), password: 'private' } },
  }, 7));
  delegationTraceStore.finish('owner', 'parent-call', id, 'complete', 'Finished');

  const collapsed = delegationTraceStore.read('owner', 'parent-call', 0, 0);
  expect(collapsed.header).toMatchObject({ status: 'complete', result: 'Finished' });
  expect(collapsed.steps).toEqual([]);
  expect(collapsed.nextCursor).toBeNull();

  const first = delegationTraceStore.read('owner', 'parent-call', 0, 1);
  expect(first.header).toMatchObject({ status: 'complete', result: 'Finished', taskId: 'task' });
  expect(first.header?.invocation).not.toContain('sk-1234567890123456');
  expect(first.steps).toMatchObject([{ id: 'read', status: 'complete', timestamp: 2 }]);
  expect(first.steps[0].args).not.toContain('private');
  expect(first.nextCursor).toBe(1);
  expect(delegationTraceStore.read('owner', 'parent-call', 1, 1).steps).toMatchObject([{ kind: 'diagnostic', text: 'warning' }]);
  const large = delegationTraceStore.read('owner', 'parent-call', 2, 1).steps[0];
  expect(large.receiptRef).toBe('large');
  expect(large.receipt?.length).toBeLessThan(17_000);
  const receipt = delegationTraceStore.readReceipt('owner', 'parent-call', 'large', 0);
  expect(receipt.text.length).toBe(32_000);
  expect(receipt.nextOffset).toBe(32_000);
  expect(delegationTraceStore.readReceipt('owner', 'parent-call', 'large', 32_000).text).not.toContain('private');
  expect(() => delegationTraceStore.readReceipt('owner', 'parent-call', 'read', 0)).toThrow(/RECEIPT_DENIED/);
  expect(delegationTraceStore.read('other', 'parent-call', 0, 10).header).toBeNull();
  expect(fixture.publish).toHaveBeenCalledWith('conversation:delegationChanged', { sessionId: 'owner', parentToolCallId: 'parent-call' });
});

it('reads a collapsed header without folding steps and marks an unfinished record interrupted after restart', () => {
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-delegation-trace-'));
  const parentToolCallId = 'unfinished';
  const target = path.join(fixture.root, 'delegations', `${createHash('sha256').update(parentToolCallId).digest('hex')}.jsonl`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, [
    JSON.stringify({ kind: 'start', header: { parentToolCallId, task: 'Inspect', profile: 'general', mode: 'wait',
      childSessionId: 'child', invocation: '{}', status: 'running', startedAt: 1 } }),
    '{ malformed old step }',
    JSON.stringify({ kind: 'step', step: { id: 'last', kind: 'message', status: 'complete', timestamp: 2, text: 'Visible' } }),
  ].join('\n') + '\n');
  expect(delegationTraceStore.read('owner', parentToolCallId, 0, 0).header?.status).toBe('interrupted');
});
