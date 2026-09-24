import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { TaskRegistry } from '../../agent-runtime/tasks';
import { BackgroundSubagentService } from './BackgroundSubagentService';
import type { DelegationCapsule } from '@shared/types/delegationCapsule';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const capsule: DelegationCapsule = { goal: 'bounded check', task: 'check', scope: 'test', acceptedFacts: [], hypotheses: [], challengeRefs: [], negativePaths: [], inputArtifactRefs: [], requiredSkillIds: [], stopConditions: ['done'], outputRequirements: 'evidence', budget: { maxToolCalls: 3, maxWallTimeMs: 10000 } };
function fixture(failSave: boolean, qualified = false) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'background-independent-')); roots.push(root);
 let registry!: TaskRegistry;
 const outputs: Record<string, string> = qualified ? { analysis: 'Twelve test designs delivered.' } : {};
 const service = new BackgroundSubagentService(async () => ({ status: 'complete', text: 'complete', completionDeclaration: { disposition: 'completed', evidenceRefs: [], result: { summary: 'complete', outputs, counterevidence: [], unresolved: qualified ? ['Implementation ordering policy needs confirmation before executing these designs.'] : [], scope: 'test design only', sideEffects: [], recoveryState: [] } } }), (_session, onCancel) => { registry = new TaskRegistry(root, { onCancelExecution: onCancel }); return registry; }, () => { if (failSave) throw new Error('disk full'); return { uri: 'session://tool-outputs/result.json', hash: 'fixture-hash' }; });
 return { service, registry: () => registry };
}
it('completes delivered requirements without promoting unresolved scope conditions into missing outputs', async () => {
 const { service, registry } = fixture(false, true); await service.query('owner', 'none');
 const task = await registry().createTask('design tests', { completionRequirements: ['analysis'] });
 const execution = await service.start({ parentToolCallId: 'test-tool', sessionId: 'owner', taskId: task.id, parentAgentId: 'general', targetProfile: 'general', capsule });
 await service.join(execution.id);
 expect((await service.query('owner', execution.id))?.result).toMatchObject({ disposition: 'completed', outputs: { analysis: 'Twelve test designs delivered.' }, unresolved: ['Implementation ordering policy needs confirmation before executing these designs.'], scope: 'test design only' });
 expect(JSON.stringify((await service.messages('owner', execution.id)).messages)).toContain('Implementation ordering policy');
});
it('never publishes completion or leaves an unmanaged running execution when result storage fails', async () => {
 const { service, registry } = fixture(true); await service.query('owner', 'none');
 const task = await registry().createTask('check');
 const execution = await service.start({ parentToolCallId: 'test-tool', sessionId: 'owner', taskId: task.id, parentAgentId: 'general', targetProfile: 'general', capsule });
 await service.join(execution.id).catch(() => undefined);
 const current = await service.query('owner', execution.id);
 expect(['blocked', 'failed', 'interrupted']).toContain(current?.status);
 expect(current?.result?.disposition).toBe('blocked');
 const messages = await service.messages('owner', execution.id);
 expect(messages.messages.filter((message) => message.kind === 'result').some((message) => message.body.includes('"disposition":"completed"'))).toBe(false);
});
it('does not publish a completed message when required output validation fails', async () => {
 const { service, registry } = fixture(false); await service.query('owner', 'none');
 const task = await registry().createTask('check', { completionRequirements: ['evidence'] });
 const execution = await service.start({ parentToolCallId: 'test-tool', sessionId: 'owner', taskId: task.id, parentAgentId: 'general', targetProfile: 'general', capsule });
 await service.join(execution.id).catch(() => undefined);
 const current = await service.query('owner', execution.id);
 expect(['blocked', 'failed']).toContain(current?.status);
 const messages = await service.messages('owner', execution.id);
 expect(messages.messages.filter((message) => message.kind === 'result').some((message) => message.body.includes('"disposition":"completed"'))).toBe(false);
});

it('returns the persisted artifact reference from the actual background_result tool', async () => {
 const { service, registry } = fixture(false); await service.query('owner', 'none');
 const task = await registry().createTask('result');
 const execution = await service.start({ parentToolCallId: 'test-tool', sessionId: 'owner', taskId: task.id, parentAgentId: 'general', targetProfile: 'general', capsule });
 await service.join(execution.id);
 const tool = service.createTools('general', 'owner').find((item) => item.name === 'background_result')!;
 const value = await tool.execute('result-read', { executionId: execution.id });
 expect(value.details).toMatchObject({ result: { resultRef: 'session://tool-outputs/result.json' } });
 expect(JSON.stringify(value.content)).not.toContain('"resultRef":"' + execution.id + '"');
});
it('keeps nested result events with the live immediate parent then transfers only bounded unconsumed data', async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'background-nested-independent-')); roots.push(root);
 let registry!: TaskRegistry; let release!: () => void;
 const gate = new Promise<void>((resolve) => { release = resolve; });
 const service = new BackgroundSubagentService(async (input) => {
  if (!input.parentExecutionId) await gate;
  return { status: 'complete', text: 'private exploration '.repeat(10000), completionDeclaration: { disposition: 'partial', evidenceRefs: [], result: { summary: 'qualified finding', outputs: {}, counterevidence: ['counterexample'], unresolved: ['unmeasured'], scope: 'capture A only', sideEffects: [], recoveryState: ['restored'] } } };
 }, (_session, onCancel) => { registry = new TaskRegistry(root, { onCancelExecution: onCancel }); return registry; }, (_session, id) => ({ uri: `session://tool-outputs/${id}.json`, hash: `hash-${id}` }));
 await service.query('owner', 'none');
 const parentTask = await registry.createTask('parent');
 const parent = await service.start({ parentToolCallId: 'test-tool', sessionId: 'owner', taskId: parentTask.id, parentAgentId: 'general', targetProfile: 'general', capsule });
 const childTask = await registry.createTask('child', { parentTaskId: parentTask.id });
 const child = await service.start({ parentToolCallId: 'test-tool', sessionId: 'owner', taskId: childTask.id, parentExecutionId: parent.id, parentAgentId: 'general', targetProfile: 'general', capsule });
 await service.join(child.id);
 expect(JSON.stringify((await service.beforeParentProviderRequestMessages('owner')).messages)).not.toContain(child.id);
 release(); await service.join(parent.id);
 const delivered = await service.beforeParentProviderRequestMessages('owner');
 const wire = JSON.stringify(delivered.messages);
 expect(wire).toContain(child.id); expect(wire).toContain(`hash-${child.id}`);
 expect(wire).toContain('counterexample'); expect(wire).toContain('capture A only');
 expect(wire).not.toContain('private exploration'); expect(wire.length).toBeLessThan(18000);
 await delivered.commit?.();
 expect((await service.beforeParentProviderRequestMessages('owner')).messages).toEqual([]);
});


it('retains new-parent spending when retry joins an older task root budget', async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'background-budget-independent-')); roots.push(root);
 let registry!: TaskRegistry; const observed: number[] = [];
 const service = new BackgroundSubagentService(async (input) => {
  observed.push(input.policyBudget!.toolCalls);
  return { status: 'complete', text: 'partial', completionDeclaration: { disposition: 'partial', evidenceRefs: [], result: { summary: 'bounded partial', outputs: {}, counterevidence: [], unresolved: ['more'], scope: 'test', sideEffects: [], recoveryState: [] } } };
 }, (_session, onCancel) => { registry = new TaskRegistry(root, { onCancelExecution: onCancel }); return registry; }, (_session, id) => ({ uri: `session://tool-outputs/${id}.json`, hash: `hash-${id}` }));
 await service.query('owner', 'none'); const task = await registry.createTask('retry with prior spending');
 const started = Date.now();
 const policy = (toolCalls: number, wallStartedAt: number) => ({ toolCalls, subagents: 0, childDepth: 0, wallStartedAt, maxToolCalls: 10, maxSubagents: 4, maxChildDepth: 2, maxWallTimeMs: 10000 });
 const first = await service.start({ parentToolCallId: 'test-tool', sessionId: 'owner', taskId: task.id, rootBudgetId: 'old-turn-root', parentAgentId: 'general', targetProfile: 'general', capsule, policyBudget: policy(2, started) }); await service.join(first.id);
 const nextPolicy = policy(1, started + 1);
 const second = await service.start({ parentToolCallId: 'test-tool', sessionId: 'owner', taskId: task.id, rootBudgetId: 'new-turn-root', parentAgentId: 'general', targetProfile: 'general', capsule, policyBudget: nextPolicy }); await service.join(second.id);
 const third = await service.start({ parentToolCallId: 'test-tool', sessionId: 'owner', taskId: task.id, rootBudgetId: 'new-turn-root', parentAgentId: 'general', targetProfile: 'general', capsule, policyBudget: nextPolicy }); await service.join(third.id);
 expect(observed).toEqual([2, 3, 3]);
 expect((await registry.getExecution(second.id))?.rootBudgetId).toBe('old-turn-root');
});
