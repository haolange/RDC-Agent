import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskRegistry } from '../../agent-runtime/tasks';
import { BackgroundSubagentService } from './BackgroundSubagentService';
import type { DelegationCapsule } from '@shared/types/delegationCapsule';
import type { RequestEnvelopeSnapshot } from '@shared/types/rdcRuntime';
import { flushPolicyBudgetObservers } from './DelegationBudget';

const roots: string[] = [];
const capsule: DelegationCapsule = {
  goal: 'Inspect', task: 'Inspect the target', scope: 'tests', acceptedFacts: [], hypotheses: [],
  challengeRefs: [], negativePaths: [], inputArtifactRefs: [], outputRequirements: 'Return findings',
  stopConditions: ['done'], requiredSkillIds: [], budget: { maxToolCalls: 4, maxWallTimeMs: 10_000 },
};
function harness(run: ConstructorParameters<typeof BackgroundSubagentService>[0], listSnapshots?: ConstructorParameters<typeof BackgroundSubagentService>[3]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'background-subagent-')); roots.push(root);
  const registries = new Map<string, TaskRegistry>();
  const service = new BackgroundSubagentService(run, (sessionId, onCancel) => {
    const registry = new TaskRegistry(path.join(root, sessionId), { onCancelExecution: onCancel });
    registries.set(sessionId, registry); return registry;
  }, (_sessionId, executionId) => ({ uri: `session://tool-outputs/background-${executionId}.json`, hash: 'fixture-hash' }), listSnapshots);
  return { service, registry: (sessionId: string) => registries.get(sessionId)! };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('BackgroundSubagentService', () => {
  it('returns immediately and persists a bounded structured result before settle notification', async () => {
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    const events: string[] = [];
    const { service, registry } = harness(async (input) => { await gate; await input.onProviderRequestCommitted?.('request-snapshot-1'); await input.onProviderRequestCommitted?.('request-snapshot-2'); return { status: 'complete', text: 'done', completionDeclaration: { disposition: 'completed', evidenceRefs: [], result: { summary: 'done', outputs: { report: 'session://result' }, counterevidence: [], unresolved: [], scope: 'one file', sideEffects: [], recoveryState: [] } } }; });
    service.onEvent = (event) => events.push(event.type);
    await service.query('s1', 'missing');
    const taskRegistry = registry('s1');
    const task = await taskRegistry.createTask('background', { completionRequirements: ['report'] });
    const execution = await service.start({ parentToolCallId: 'test-tool', sessionId: 's1', taskId: task.id, parentAgentId: 'general', targetProfile: 'general', capsule });
    expect(execution.status).toBe('running'); release(); await service.join(execution.id);
    expect((await registry('s1').getExecution(execution.id))?.result?.outputs.report).toBe('session://result');
    expect((await registry('s1').getExecution(execution.id))?.frozenPlanRef).toBe('request-snapshot-1');
    expect(events).toEqual(['started', 'settled']);
  });

  it('delivers parent events once and acknowledges them only after the request commit', async () => {
    const { service, registry } = harness(async () => ({ status: 'complete', text: 'done', completionDeclaration: { disposition: 'completed', evidenceRefs: [], result: { summary: 'done', outputs: {}, counterevidence: [], unresolved: [], scope: 'test', sideEffects: [], recoveryState: [] } } }));
    await service.query('s1', 'missing');
    const task = await registry('s1').createTask('parent mailbox');
    const execution = await service.start({ parentToolCallId: 'test-tool', sessionId: 's1', taskId: task.id, parentAgentId: 'general', targetProfile: 'general', capsule });
    await service.join(execution.id);
    const pending = await service.beforeParentProviderRequestMessages('s1');
    expect(JSON.stringify(pending.messages)).toContain(execution.id);
    expect((await registry('s1').getExecution(execution.id))?.parentMessageAckSequence).toBe(0);
    await pending.commit?.();
    const afterCommit = await service.beforeParentProviderRequestMessages('s1');
    expect(afterCommit.messages).toEqual([]);
  });

  it('recovers a parent mailbox commit from structured request metadata after a crash before ack', async () => {
    const snapshots: RequestEnvelopeSnapshot[] = [];
    const { service, registry } = harness(async () => ({ status: 'complete', text: 'done', completionDeclaration: { disposition: 'completed', evidenceRefs: [], result: { summary: 'done', outputs: {}, counterevidence: [], unresolved: [], scope: 'test', sideEffects: [], recoveryState: [] } } }), () => snapshots);
    await service.query('s1', 'missing');
    const task = await registry('s1').createTask('parent crash recovery');
    const execution = await service.start({ parentToolCallId: 'test-tool', sessionId: 's1', taskId: task.id, parentAgentId: 'general', targetProfile: 'general', capsule });
    await service.join(execution.id);
    const pending = await service.beforeParentProviderRequestMessages('s1');
    snapshots.push({ mailboxDeliveries: pending.mailboxDeliveries } as RequestEnvelopeSnapshot);
    const recovered = await service.beforeParentProviderRequestMessages('s1');
    expect(recovered.messages).toEqual([]);
  });

  it('rejects cross-session tool ownership before cancellation', async () => {
    const { service, registry } = harness(async ({ signal }) => new Promise((resolve) => signal.addEventListener('abort', () => resolve({ status: 'cancelled', text: 'cancelled' }), { once: true })));
    await service.query('s1', 'missing');
    const task = await registry('s1').createTask('background');
    const execution = await service.start({ parentToolCallId: 'test-tool', sessionId: 's1', taskId: task.id, parentAgentId: 'general', targetProfile: 'general', capsule });
    await expect(service.cancel('s2', execution.id)).rejects.toThrow(/not owned/);
    await service.cancel('s1', execution.id);
  });

  it('delivers and acknowledges owner data only at a provider request boundary', async () => {
    let enter!: () => void; const gate = new Promise<void>((resolve) => { enter = resolve; });
    let delivered = '';
    const { service, registry } = harness(async (input) => {
      await gate;
      const pending = await input.beforeProviderRequestMessages!();
      delivered = JSON.stringify(pending.messages);
      await pending.commit?.();
      return { status: 'complete', text: 'done', completionDeclaration: { disposition: 'completed', evidenceRefs: [], result: { summary: 'done', outputs: {}, counterevidence: [], unresolved: [], scope: 'test', sideEffects: [], recoveryState: [] } } };
    });
    await service.query('s1', 'missing');
    const task = await registry('s1').createTask('mailbox');
    const execution = await service.start({ parentToolCallId: 'test-tool', sessionId: 's1', taskId: task.id, parentAgentId: 'general', targetProfile: 'general', capsule });
    await service.postMessage('s1', execution.id, execution.generation, 'observed condition');
    enter(); await service.join(execution.id);
    expect(delivered).toContain('observed condition');
    expect((await registry('s1').getExecution(execution.id))?.childMessageAckSequence).toBeGreaterThan(0);
  });

  it('recovers a child mailbox commit from structured request metadata after a crash before ack', async () => {
    const snapshots: RequestEnvelopeSnapshot[] = [];
    let enter!: () => void; const gate = new Promise<void>((resolve) => { enter = resolve; });
    let redelivered = true;
    const { service, registry } = harness(async (input) => {
      await gate;
      const pending = await input.beforeProviderRequestMessages!();
      snapshots.push({ mailboxDeliveries: pending.mailboxDeliveries } as never);
      const recovered = await input.beforeProviderRequestMessages!();
      redelivered = recovered.messages.length > 0;
      return { status: 'complete', text: 'done', completionDeclaration: { disposition: 'completed', evidenceRefs: [], result: { summary: 'done', outputs: {}, counterevidence: [], unresolved: [], scope: 'test', sideEffects: [], recoveryState: [] } } };
    }, () => snapshots as never);
    await service.query('s1', 'missing');
    const task = await registry('s1').createTask('crash recovery');
    const execution = await service.start({ parentToolCallId: 'test-tool', sessionId: 's1', taskId: task.id, parentAgentId: 'general', targetProfile: 'general', capsule });
    await service.postMessage('s1', execution.id, execution.generation, 'deliver once');
    enter(); await service.join(execution.id);
    expect(redelivered).toBe(false);
  });

  it('pages a large owner mailbox without duplicate delivery or exceeding the request bound', async () => {
    let enter!: () => void; const gate = new Promise<void>((resolve) => { enter = resolve; });
    const deliveries: string[] = [];
    const { service, registry } = harness(async (input) => {
      await gate;
      for (let pageIndex = 0; pageIndex < 3; pageIndex += 1) {
        const pending = await input.beforeProviderRequestMessages!();
        if (!pending.messages.length) break;
        const rendered = JSON.stringify(pending.messages);
        expect(rendered.length).toBeLessThan(18_000);
        deliveries.push(rendered);
        await pending.commit?.();
      }
      return { status: 'complete', text: 'done', completionDeclaration: { disposition: 'completed', evidenceRefs: [], result: { summary: 'done', outputs: {}, counterevidence: [], unresolved: [], scope: 'test', sideEffects: [], recoveryState: [] } } };
    });
    await service.query('s1', 'missing');
    const task = await registry('s1').createTask('paged mailbox');
    const execution = await service.start({ parentToolCallId: 'test-tool', sessionId: 's1', taskId: task.id, parentAgentId: 'general', targetProfile: 'general', capsule });
    for (let index = 0; index < 40; index += 1) {
      await service.postMessage('s1', execution.id, execution.generation, `message-${index}-${'x'.repeat(500)}`);
    }
    enter(); await service.join(execution.id);
    expect(deliveries).toHaveLength(2);
    const combined = deliveries.join('\n');
    for (let index = 0; index < 40; index += 1) expect(combined.match(new RegExp(`message-${index}-`, 'g'))).toHaveLength(1);
  });

  it('does not expose exploratory final text as a successful result when the typed envelope is missing', async () => {
    const secretExploration = 'private scratch reasoning '.repeat(300);
    const { service, registry } = harness(async () => ({ status: 'complete', text: secretExploration }));
    await service.query('s1', 'missing');
    const task = await registry('s1').createTask('typed result');
    const execution = await service.start({ parentToolCallId: 'test-tool', sessionId: 's1', taskId: task.id, parentAgentId: 'general', targetProfile: 'general', capsule });
    await service.join(execution.id);
    const stored = await registry('s1').getExecution(execution.id);
    expect(stored?.status).toBe('partial');
    expect(stored?.result?.summary).not.toContain('private scratch');
    expect(stored?.result?.error?.length).toBeLessThanOrEqual(8_000);
    expect(stored?.result?.resultRef).toContain('session://tool-outputs/background-');
  });

  it('persists waiting and running around a delegated approval request', async () => {
    let observedWaiting = false;
    const { service, registry } = harness(async (input) => {
      input.parentOnEvent?.({ id: 'approval-1', type: 'approval.requested', timestamp: Date.now(), sessionId: 's1', agentId: 'general', payload: { approvalId: 'a1', toolCallId: 't1', toolName: 'shell', args: {} } });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const current = (await registry('s1').listExecutions()).at(-1);
      observedWaiting = current?.status === 'waiting';
      input.parentOnEvent?.({ id: 'approval-2', type: 'approval.answered', timestamp: Date.now(), sessionId: 's1', agentId: 'general', payload: { approvalId: 'a1', toolCallId: 't1', toolName: 'shell', approved: true } as never });
      return { status: 'complete', text: 'done', completionDeclaration: { disposition: 'completed', evidenceRefs: [], result: { summary: 'done', outputs: {}, counterevidence: [], unresolved: [], scope: 'test', sideEffects: [], recoveryState: [] } } };
    });
    await service.query('s1', 'missing');
    const task = await registry('s1').createTask('approval');
    const execution = await service.start({ parentToolCallId: 'test-tool', sessionId: 's1', taskId: task.id, parentAgentId: 'general', targetProfile: 'general', capsule });
    await service.join(execution.id);
    expect(observedWaiting).toBe(true);
    expect((await registry('s1').getExecution(execution.id))?.status).toBe('completed');
  });

  it('restores the child-local Capsule ledger on an explicit later execution', async () => {
    const restored: number[] = [];
    const limitedCapsule = { ...capsule, budget: { ...capsule.budget, maxToolCalls: 1 } };
    const { service, registry } = harness(async (input) => {
      restored.push(input.restoredPolicyBudget?.toolCalls ?? -1);
      return { status: 'complete', text: 'partial', policyBudget: { ...input.restoredPolicyBudget!, toolCalls: 1 }, completionDeclaration: { disposition: 'partial', evidenceRefs: [], result: { summary: 'retry required', outputs: {}, counterevidence: [], unresolved: ['more work'], scope: 'test', sideEffects: [], recoveryState: [] } } };
    });
    await service.query('s1', 'missing');
    const task = await registry('s1').createTask('retry budget');
    const first = await service.start({ parentToolCallId: 'test-tool', sessionId: 's1', taskId: task.id, parentAgentId: 'general', targetProfile: 'general', capsule: limitedCapsule });
    await service.join(first.id);
    const second = await service.start({ parentToolCallId: 'test-tool', sessionId: 's1', taskId: task.id, parentAgentId: 'general', targetProfile: 'general', capsule: limitedCapsule });
    await service.join(second.id);
    expect(restored).toEqual([0, 1]);
    expect((await registry('s1').getExecution(second.id))?.budget.toolCalls).toBe(1);
  });

  it('restores the shared root ledger without a parent execution on a later turn', async () => {
    const observed: number[] = [];
    const { service, registry } = harness(async (input) => {
      observed.push(input.policyBudget!.toolCalls);
      input.policyBudget!.toolCalls += 1;
      await flushPolicyBudgetObservers(input.policyBudget);
      return { status: 'complete', text: 'partial', policyBudget: input.restoredPolicyBudget, completionDeclaration: { disposition: 'partial', evidenceRefs: [], result: { summary: 'retry', outputs: {}, counterevidence: [], unresolved: ['more'], scope: 'test', sideEffects: [], recoveryState: [] } } };
    });
    await service.query('s1', 'missing');
    const task = await registry('s1').createTask('root retry');
    const policy = () => ({ toolCalls: 0, subagents: 0, childDepth: 0, wallStartedAt: Date.now(), maxToolCalls: 2, maxSubagents: 2, maxChildDepth: 2, maxWallTimeMs: 10_000 });
    const first = await service.start({ parentToolCallId: 'test-tool', sessionId: 's1', taskId: task.id, rootBudgetId: 'turn:first', parentAgentId: 'general', targetProfile: 'general', capsule, policyBudget: policy(), subagentBudget: { depth: 0, childrenSpawned: 0, aggregateToolCalls: 0, wallStartedAt: Date.now(), budget: { maxDepth: 2, maxChildren: 2, maxAggregateToolCalls: 2, maxAggregateWallMs: 10_000 } } });
    await service.join(first.id);
    const second = await service.start({ parentToolCallId: 'test-tool', sessionId: 's1', taskId: task.id, rootBudgetId: 'turn:second', parentAgentId: 'general', targetProfile: 'general', capsule, policyBudget: policy(), subagentBudget: { depth: 0, childrenSpawned: 0, aggregateToolCalls: 0, wallStartedAt: Date.now(), budget: { maxDepth: 2, maxChildren: 2, maxAggregateToolCalls: 2, maxAggregateWallMs: 10_000 } } });
    await service.join(second.id);
    expect(observed).toEqual([0, 1]);
    expect((await registry('s1').getExecution(second.id))?.rootBudgetId).toBe('turn:first');
  });
});
