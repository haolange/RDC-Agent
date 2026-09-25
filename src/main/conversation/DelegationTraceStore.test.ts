import fs from 'node:fs';
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

const event = (type: AgentEvent['type'], payload: object, timestamp: number): AgentEvent => ({
  id: `event-${timestamp}`, type, timestamp, payload: payload as AgentEvent['payload'],
});

it('stores a single owned child process with revision updates and separate final and parent receipt', () => {
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-delegation-trace-'));
  const id = 'child\u0000execution\u00001';
  delegationTraceStore.start('owner', {
    parentToolCallId: 'parent-call', task: 'Inspect config', profile: 'general', mode: 'background',
    executionId: 'execution', generation: 1, taskId: 'task', childSessionId: 'child',
    invocation: JSON.stringify({ task: 'Inspect config', apiKey: 'sk-1234567890123456' }),
    status: 'running', startedAt: 1,
  });
  delegationTraceStore.updateTask('owner', 'parent-call', id, { capsule: {
    goal: 'Inspect', task: 'Inspect actual config', scope: 'Read only', acceptedFacts: [],
    hypotheses: [], challengeRefs: [], negativePaths: [], inputArtifactRefs: [],
    outputRequirements: 'Return findings', stopConditions: [], requiredSkillIds: [], budget: { maxToolCalls: 4, maxWallTimeMs: 60000 },
  }, completionRequirements: [] }, 'Exact sent prompt');
  delegationTraceStore.event('owner', 'parent-call', id, event('assistant.thinking_delta', { text: 'Check config' }, 2));
  delegationTraceStore.event('owner', 'parent-call', id, event('tool.started', {
    toolCallId: 'read', toolName: 'read_file', args: { path: 'config', password: 'private' },
  }, 3));
  delegationTraceStore.event('owner', 'parent-call', 'stale', event('diagnostic', {
    code: 'IGNORED', severity: 'error', message: 'stale',
  }, 4));
  delegationTraceStore.event('owner', 'parent-call', id, event('tool.completed', {
    toolCallId: 'read', toolName: 'read_file', result: { ok: true, data: { content: 'done', password: 'private' } },
  }, 5));
  delegationTraceStore.event('owner', 'parent-call', id, event('assistant.completed', {
    text: 'Inspected the configuration.', stopReason: 'end_turn',
  }, 6));
  const longFinal = `Final reply\n\n${'x'.repeat(12_000)}`;
  delegationTraceStore.finish('owner', 'parent-call', id, 'complete', longFinal);
  delegationTraceStore.setParentReceipt('owner', 'parent-call', { ok: true, data: { text: 'Parent receipt' } });

  const collapsed = delegationTraceStore.read('owner', 'parent-call', 0, 0);
  expect(collapsed.header).toMatchObject({ status: 'complete', total: 1, finalAvailable: true });
  expect(collapsed.steps).toEqual([]);
  expect(collapsed.header?.finalPreview).toBe('Final reply');
  expect(collapsed.header?.task).toBe('Inspect actual config');
  const identity = { childSessionId: 'child', executionId: 'execution', generation: 1 };
  expect(delegationTraceStore.readContent('owner', 'parent-call', identity, 'final', 0).text).toBe(longFinal);
  expect(delegationTraceStore.readContent('owner', 'parent-call', identity, 'parent_receipt', 0).text).toContain('Parent receipt');
  expect(delegationTraceStore.readContent('owner', 'parent-call', identity, 'task', 0).text).toContain('Return findings');
  expect(delegationTraceStore.readContent('owner', 'parent-call', identity, 'invocation', 0).text).not.toContain('sk-1234567890123456');
  const first = delegationTraceStore.read('owner', 'parent-call', 0, 1);
  expect(first.steps[0]?.block.toolCalls[0]?.argsPreview).not.toContain('private');
  expect(first.steps[0]?.block.toolCalls[0]?.status).toBe('complete');
  const update = delegationTraceStore.read('owner', 'parent-call', 0, 40, first.steps[0]!.revision - 1);
  expect(update.steps).toHaveLength(1);
  expect(() => delegationTraceStore.readContent('owner', 'parent-call', identity, 'tool_receipt', 0, 'unknown')).toThrow(/DENIED/);
  expect(() => delegationTraceStore.readContent('owner', 'parent-call', { ...identity, generation: 2 }, 'final', 0)).toThrow(/DENIED/);
  expect(delegationTraceStore.read('other', 'parent-call', 0, 0).header).toBeNull();
  expect(fixture.publish).toHaveBeenCalledWith('conversation:delegationChanged',
    expect.objectContaining({ sessionId: 'owner', parentToolCallId: 'parent-call', revision: expect.any(Number) }));
});

it('keeps Task Execution status separate from the child final and rejects stale execution updates', () => {
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-delegation-trace-'));
  const childIdentity = 'child\u0000execution\u00003';
  delegationTraceStore.start('owner', {
    parentToolCallId: 'execution-status', task: 'Inspect', profile: 'general', mode: 'background',
    executionId: 'execution', generation: 3, taskId: 'task', childSessionId: 'child',
    invocation: '{}', status: 'running', startedAt: Date.now(),
  });
  delegationTraceStore.setExecutionStatus('owner', 'execution-status', childIdentity, 'waiting');
  expect(delegationTraceStore.read('owner', 'execution-status', 0, 0).header?.executionStatus).toBe('waiting');
  delegationTraceStore.finish('owner', 'execution-status', childIdentity, 'complete', 'Child final');
  expect(delegationTraceStore.read('owner', 'execution-status', 0, 0).header).toMatchObject({ status: 'complete', executionStatus: 'waiting' });
  delegationTraceStore.setExecutionStatus('owner', 'execution-status', 'child\u0000execution\u00002', 'completed');
  expect(delegationTraceStore.read('owner', 'execution-status', 0, 0).header?.executionStatus).toBe('waiting');
  delegationTraceStore.setExecutionStatus('owner', 'execution-status', childIdentity, 'partial');
  expect(delegationTraceStore.read('owner', 'execution-status', 0, 0).header).toMatchObject({
    status: 'complete', executionStatus: 'partial', finalPreview: 'Child final',
  });
  delegationTraceStore.setExecutionStatus('owner', 'execution-status', childIdentity, 'running');
  expect(delegationTraceStore.read('owner', 'execution-status', 0, 0).header?.executionStatus).toBe('partial');
});

it('reads long Unicode final replies in bounded UTF-8 chunks without losing characters', () => {
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-delegation-trace-'));
  const childIdentity = 'child\u0000\u0000';
  delegationTraceStore.start('owner', {
    parentToolCallId: 'unicode', task: 'Reply', profile: 'general', mode: 'wait',
    childSessionId: 'child', invocation: '{}', status: 'running', startedAt: 1,
  });
  const final = `答复：${'配置已读取。'.repeat(9000)}`;
  delegationTraceStore.finish('owner', 'unicode', childIdentity, 'complete', final);
  let offset: number | null = 0;
  let collected = '';
  while (offset !== null) {
    const page = delegationTraceStore.readContent('owner', 'unicode', { childSessionId: 'child' }, 'final', offset);
    expect(Buffer.byteLength(page.text, 'utf8')).toBeLessThanOrEqual(32_000);
    collected += page.text;
    offset = page.nextOffset;
  }
  expect(collected).toBe(final);
});

it('marks unfinished records interrupted after restart and refuses old records without a head contract', async () => {
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-delegation-trace-'));
  delegationTraceStore.start('owner', {
    parentToolCallId: 'unfinished', task: 'Inspect', profile: 'general', mode: 'wait',
    childSessionId: 'child', invocation: '{}', status: 'running', startedAt: 1,
  });
  delegationTraceStore.event('owner', 'unfinished', 'child\u0000\u0000', event('assistant.thinking_delta', { text: 'Visible work' }, 2));
  delegationTraceStore.event('owner', 'unfinished', 'child\u0000\u0000', event('tool.started', { toolCallId: 'running', toolName: 'read_file' }, 3));
  const target = path.join(fixture.root, 'delegations', 'old.jsonl');
  fs.writeFileSync(target, '{ old record }\n');
  // No active producer exists after a restart; a persisted running record is interrupted.
  const head = path.join(fixture.root, 'delegations', fs.readdirSync(path.join(fixture.root, 'delegations')).find((name) => name.endsWith('.head.json'))!);
  const stored = JSON.parse(fs.readFileSync(head, 'utf8')) as Record<string, unknown>;
  expect(stored.status).toBe('running');
  vi.resetModules();
  const restarted = (await import('./DelegationTraceStore')).delegationTraceStore;
  const interrupted = restarted.read('owner', 'unfinished', 0, 0).header;
  expect(interrupted?.status).toBe('interrupted');
  expect(interrupted?.completedAt).toBe(stored.updatedAt);
  const recovered = restarted.read('owner', 'unfinished', 0, 40);
  expect(recovered.steps.length).toBeGreaterThan(0);
  for (const { block } of recovered.steps) {
    expect(block.thinkingStatus).toBe('complete');
    expect(block.status).toBe('error');
    expect(block.completedAt).toBe(interrupted?.completedAt);
    expect(block.toolCalls[0]).toMatchObject({ status: 'error', completedAt: interrupted?.completedAt });
  }
  expect(delegationTraceStore.read('owner', 'missing', 0, 0).error).toBe('DELEGATION_TRACE_UNAVAILABLE');
});

it('keeps execution failure separate from final reply and rejects cross-execution content', () => {
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-delegation-trace-'));
  const identity = 'child\u0000run\u00002';
  delegationTraceStore.start('owner', {
    parentToolCallId: 'failed', task: 'Read config', profile: 'general', mode: 'wait',
    childSessionId: 'child', executionId: 'run', generation: 2,
    invocation: '{}', status: 'running', startedAt: Date.now(),
  });
  delegationTraceStore.finish('owner', 'failed', identity, 'failed', 'Provider failed');
  const header = delegationTraceStore.read('owner', 'failed', 0, 0).header;
  expect(header).toMatchObject({ status: 'failed', error: 'Provider failed' });
  expect(header?.finalAvailable).toBeUndefined();
  expect(() => delegationTraceStore.readContent('owner', 'failed',
    { childSessionId: 'child', executionId: 'run', generation: 2 }, 'final', 0)).toThrow(/UNAVAILABLE/);
  expect(() => delegationTraceStore.readContent('owner', 'failed',
    { childSessionId: 'child', executionId: 'different', generation: 2 }, 'task', 0)).toThrow(/DENIED/);
});

it.each(['complete', 'failed', 'cancelled'] as const)('settles every owned step before publishing %s and rejects late events', (status) => {
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-delegation-terminal-'));
  const call = `terminal-${status}`;
  const identity = 'child\u0000\u0000';
  delegationTraceStore.start('owner', { parentToolCallId: call, task: 'Inspect', profile: 'general', mode: 'wait',
    childSessionId: 'child', invocation: '{}', status: 'running', startedAt: 1 });
  delegationTraceStore.event('owner', call, identity, event('assistant.thinking_delta', { text: 'Visible thought' }, 2));
  delegationTraceStore.event('owner', call, identity, event('tool.requested', { toolCall: { id: 'pending', name: 'turn_complete', arguments: {} } }, 3));
  delegationTraceStore.event('owner', call, identity, event('tool.started', { toolCallId: 'started', toolName: 'read_file' }, 4));
  const before = delegationTraceStore.read('owner', call, 0, 0).revision;
  delegationTraceStore.finish('owner', call, identity, status, 'Ended');
  const page = delegationTraceStore.read('owner', call, 0, 40, before);
  expect(page.steps.length).toBeGreaterThan(0);
  for (const { block } of page.steps) {
    expect(['running', 'pending']).not.toContain(block.status);
    expect(block.thinkingStatus).toBe('complete');
    expect(block.completedAt).toBe(page.header?.completedAt);
    expect(block.toolCalls.find(tool => tool.id === 'started')).toMatchObject({ status: 'error', completedAt: page.header?.completedAt });
    expect(block.toolCalls.find(tool => tool.id === 'pending')?.status).toBe(status === 'complete' ? 'skipped' : 'error');
  }
  delegationTraceStore.event('owner', call, identity, event('assistant.thinking_delta', { text: 'Late' }, 9));
  expect(delegationTraceStore.read('owner', call, 0, 40)).toEqual({ ...page, nextCursor: null });
});

it('does not offer an empty final body or misreport a resource limit', () => {
  fixture.root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-delegation-empty-'));
  delegationTraceStore.start('owner', { parentToolCallId: 'empty', task: 'Inspect', profile: 'general', mode: 'wait',
    childSessionId: 'child', invocation: '{}', status: 'running', startedAt: 1 });
  delegationTraceStore.finish('owner', 'empty', 'child\u0000\u0000', 'complete', '  ');
  const header = delegationTraceStore.read('owner', 'empty', 0, 0).header;
  expect(header?.finalAvailable).toBe(false);
  expect(header?.finalUnavailableReason).toBeUndefined();
});
