import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { TaskRegistry } from './TaskRegistry';
import { FileTaskStore } from './TaskStore';
import { snapshotTaskRequirement, preparePlanTaskRequirements } from './TaskExecutionRequirements';
import { createTaskTools } from './TaskTools';
import { TaskExecutionPreparationSchema, TaskExecutionRequirementsSchema, type PlanTaskRequirement, type TaskExecutionPreparation } from '@shared/types/taskExecution';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-requirements-')); roots.push(root);
  let approved: PlanTaskRequirement[] = [];
  const store = new FileTaskStore(root, async () => approved);
  return { store, registry: new TaskRegistry(store), approve: (tasks: PlanTaskRequirement[]) => { approved = tasks; } };
}
function preparation(sessionId = 'child'): TaskExecutionPreparation {
  return {
    sessionId, turnId: 'turn', runtimeFingerprint: 'a'.repeat(24), capsuleHash: 'b'.repeat(64),
    skills: [{ id: 'analysis-method', hash: 'c'.repeat(64) }], inputArtifacts: [],
    selectedTurnCount: 0, requestsDomainCapability: false,
  };
}
const delegated = { mode: 'subagent' as const, requiredSkillIds: ['analysis-method'], independentOfTaskIds: [] };
const result = { disposition: 'completed' as const, summary: 'Delivered current material analysis.', outputs: { analysis: 'Bounded conclusion, counterevidence and limitations.' } };

it('distinguishes the runtime fingerprint from full artifact and method hashes', () => {
  expect(TaskExecutionPreparationSchema.parse(preparation()).runtimeFingerprint).toHaveLength(24);
  expect(() => TaskExecutionPreparationSchema.parse({ ...preparation(), runtimeFingerprint: 'a'.repeat(64) })).toThrow();
  expect(() => TaskExecutionPreparationSchema.parse({ ...preparation(), capsuleHash: 'b'.repeat(24) })).toThrow();
  expect(() => TaskExecutionPreparationSchema.parse({ ...preparation(), skills: [{ id: 'method', hash: 'c'.repeat(24) }] })).toThrow();
});

it('requires actual preloading and runtime proof before delegated completion', async () => {
  const { registry } = await fixture();
  const task = await registry.createTask('Analyze material', { executionRequirements: delegated, completionRequirements: ['analysis'] });
  await expect(registry.startExecution(task.id, { mode: 'subagent' })).rejects.toThrow('Required methods');
  const execution = await registry.startExecution(task.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'] });
  await expect(registry.settleExecution(execution.id, { expectedGeneration: execution.generation, status: 'completed', result })).rejects.toThrow('preparation proof');
  await registry.updateTask(task.id, { metadata: { preparation: preparation(), mode: 'subagent' } });
  await expect(registry.bindExecutionPreparation(execution.id, execution.generation, { ...preparation(), skills: [] })).rejects.toThrow('actually preloaded');
  await registry.bindExecutionPreparation(execution.id, execution.generation, preparation());
  await registry.settleExecution(execution.id, { expectedGeneration: execution.generation, status: 'completed', result });
  expect(await registry.getTask(task.id)).toMatchObject({ status: 'completed' });
});

it('checks independent context, source execution and absence of inherited domain capabilities', async () => {
  const { registry } = await fixture();
  const source = await registry.createTask('Generate findings');
  const sourceExecution = await registry.startExecution(source.id, { mode: 'direct', preparation: preparation('parent') });
  await registry.settleExecution(sourceExecution.id, { expectedGeneration: 1, status: 'completed', result });
  const review = await registry.createTask('Independent review', { executionRequirements: { ...delegated, independentOfTaskIds: [source.id] } });
  const execution = await registry.startExecution(review.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'] });
  for (const input of [preparation('parent'), { ...preparation(), selectedTurnCount: 1 }, { ...preparation(), selectedTurnCount: null }, { ...preparation(), requestsDomainCapability: true }]) {
    await expect(registry.bindExecutionPreparation(execution.id, 1, input)).rejects.toThrow('TASK_EXECUTION_REQUIREMENTS');
  }
  await registry.bindExecutionPreparation(execution.id, 1, preparation('reviewer'));
  await expect(registry.bindExecutionPreparation(execution.id, 1, preparation('another-reviewer'))).rejects.toThrow('immutable');
  await registry.settleExecution(execution.id, { expectedGeneration: 1, status: 'completed', result });
});

it('does not use unknown historical source preparation as independence proof', async () => {
  const { registry } = await fixture();
  const source = await registry.createTask('Old findings');
  const sourceExecution = await registry.startExecution(source.id, { mode: 'direct' });
  await registry.settleExecution(sourceExecution.id, { expectedGeneration: 1, status: 'completed', result });
  const review = await registry.createTask('Review old findings', { executionRequirements: { ...delegated, independentOfTaskIds: [source.id] } });
  const execution = await registry.startExecution(review.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'] });
  await expect(registry.bindExecutionPreparation(execution.id, 1, preparation())).rejects.toThrow('actually prepared');
});

it('binds independent review to the actual generating revision and generation', async () => {
  const { registry } = await fixture();
  const source = await registry.createTask('Generate findings');
  const first = await registry.startExecution(source.id, { mode: 'direct', preparation: preparation('parent') });
  const review = await registry.createTask('Independent review', { executionRequirements: { ...delegated, independentOfTaskIds: [source.id] } });
  const execution = await registry.startExecution(review.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'] });
  await registry.bindExecutionPreparation(execution.id, 1, preparation('reviewer'));
  expect((await registry.getExecution(execution.id))?.independentSources).toEqual([{ taskId: source.id, executionId: first.id, generation: 1, taskRevision: 1 }]);
  await registry.settleExecution(first.id, { expectedGeneration: 1, status: 'partial', result: { ...result, disposition: 'partial' } });
  await registry.startExecution(source.id, { mode: 'direct', preparation: preparation('parent-next') });
  await expect(registry.settleExecution(execution.id, { expectedGeneration: 1, status: 'completed', result })).rejects.toThrow('changed after review preparation');
});

it('freezes approved obligations without preventing metadata or in-scope detail Tasks', async () => {
  const { registry, approve } = await fixture();
  const task = await registry.createTask('Required analysis', { executionRequirements: delegated, completionRequirements: ['analysis'] });
  approve([snapshotTaskRequirement(task)]);
  for (const change of [{ subject: 'Skip analysis' }, { description: 'New weaker goal' }, { completionRequirements: [] }, { executionRequirements: { ...delegated, mode: 'direct' as const } }]) {
    await expect(registry.updateTask(task.id, change)).rejects.toThrow('approved plan obligation');
  }
  await registry.updateTask(task.id, { metadata: { note: 'Progress only' } });
  const other = await registry.createTask('Different work');
  const otherExecution = await registry.startExecution(other.id, { mode: 'direct' });
  await registry.settleExecution(otherExecution.id, { expectedGeneration: 1, status: 'completed', result });
  await expect(registry.assertApprovedTasksCompleted()).rejects.toThrow(task.id);
  expect((await registry.getTask(task.id))?.executionRequirements).toEqual(delegated);
});

it('rejects changed canonical obligations at start and settlement rather than trusting cached fields', async () => {
  const { registry, store, approve } = await fixture();
  const task = await registry.createTask('Required analysis', { executionRequirements: delegated });
  approve([snapshotTaskRequirement(task)]);
  await store.saveTask({ ...task, description: 'Tampered' });
  await expect(registry.startExecution(task.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'] })).rejects.toThrow('approved plan obligation');
  await store.saveTask(task);
  const execution = await registry.startExecution(task.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'] });
  await registry.bindExecutionPreparation(execution.id, 1, preparation());
  const current = (await registry.getTask(task.id))!;
  await store.saveTask({ ...current, description: 'Tampered again' });
  await expect(registry.settleExecution(execution.id, { expectedGeneration: 1, status: 'completed', result })).rejects.toThrow('approved plan obligation');
});

it('preserves retry generation, limits, consumption and stale-proof rejection', async () => {
  const { registry } = await fixture();
  const task = await registry.createTask('Analyze material', { executionRequirements: delegated });
  const deadlineAt = Date.now() + 60_000;
  const first = await registry.startExecution(task.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'], budget: { toolCalls: 3, maxToolCalls: 8, deadlineAt } });
  await registry.bindExecutionPreparation(first.id, 1, preparation());
  await registry.settleExecution(first.id, { expectedGeneration: 1, status: 'partial', result: { ...result, disposition: 'partial' } });
  const second = await registry.startExecution(task.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'], budget: { toolCalls: 0, maxToolCalls: 12, deadlineAt: Date.now() + 120_000 } });
  expect(second).toMatchObject({ generation: 2, budget: { toolCalls: 3, maxToolCalls: 8, deadlineAt } });
  expect(second.preparation).toBeUndefined();
  await expect(registry.bindExecutionPreparation(first.id, 1, preparation())).rejects.toThrow('Stale');
  await expect(registry.settleExecution(second.id, { expectedGeneration: 1, status: 'completed', result })).rejects.toThrow('Stale');
});

it('parses strict tool constraints and does not accept metadata as their substitute', async () => {
  const { registry } = await fixture();
  const tools = createTaskTools(registry);
  const create = tools.find(tool => tool.name === 'task_create')!;
  const update = tools.find(tool => tool.name === 'task_update')!;
  await expect(create.execute('bad', { tasks: [{ subject: 'Bad', executionRequirements: { ...delegated, arbitraryGrant: true } }] } as never)).rejects.toThrow();
  const value = await create.execute('create', { tasks: [{ subject: 'Required review', executionRequirements: { mode: 'subagent' } }] } as never);
  const taskId = (value.details as { ids: string[] }).ids[0];
  await expect(update.execute('start', { taskId, status: 'in_progress', metadata: { mode: 'subagent' } } as never)).rejects.toThrow();
  await expect(update.execute('start', { taskId, status: 'in_progress' } as never)).rejects.toThrow('requires subagent');
  expect(TaskExecutionRequirementsSchema.safeParse({ mode: 'direct', independentOfTaskIds: ['source'] }).success).toBe(false);
});

it('installs an explicitly approved revision without rewriting executions or resetting their budget', async () => {
  const { registry, approve } = await fixture();
  const task = await registry.createTask('Analyze material', { completionRequirements: ['analysis'] });
  const deadlineAt = Date.now() + 60_000;
  const first = await registry.startExecution(task.id, { mode: 'direct', budget: { toolCalls: 3, maxToolCalls: 8, deadlineAt } });
  await registry.settleExecution(first.id, { expectedGeneration: 1, status: 'partial', result: { ...result, disposition: 'partial' } });
  const oldExecution = await registry.getExecution(first.id);
  approve([snapshotTaskRequirement(task)]);
  const proposed = await preparePlanTaskRequirements(registry, [task.id], [{ taskId: task.id, expectedRevision: 1, executionRequirements: delegated }]);
  expect((await registry.getTask(task.id))?.executionRequirements).toBeUndefined();
  expect(proposed[0]).toMatchObject({ revision: 2, replacesRevision: 1, executionRequirements: delegated });
  await registry.installApprovedTaskRevisions(proposed);
  await registry.installApprovedTaskRevisions(proposed); // Retrying the same approval does not advance again.
  expect(await registry.getExecution(first.id)).toEqual(oldExecution);
  await expect(registry.startExecution(task.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'] })).rejects.toThrow('approved plan obligation');
  approve(proposed);
  const next = await registry.startExecution(task.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'], budget: { toolCalls: 0, maxToolCalls: 20, deadlineAt: Date.now() + 120_000 } });
  expect(next).toMatchObject({ generation: 2, taskRevision: 2, budget: { toolCalls: 3, maxToolCalls: 8, deadlineAt } });
});

it('rejects active, stale, unrelated and completed revision proposals', async () => {
  const { registry } = await fixture();
  const task = await registry.createTask('Material work');
  await expect(preparePlanTaskRequirements(registry, [task.id], [{ taskId: task.id, expectedRevision: 2, description: 'New' }])).rejects.toThrow('stale');
  await expect(preparePlanTaskRequirements(registry, [], [{ taskId: task.id, expectedRevision: 1, description: 'New' }])).rejects.toThrow('requiredTaskIds');
  const execution = await registry.startExecution(task.id, { mode: 'direct' });
  await expect(preparePlanTaskRequirements(registry, [task.id], [{ taskId: task.id, expectedRevision: 1, description: 'New' }])).rejects.toThrow('Cancel and join');
  await registry.settleExecution(execution.id, { expectedGeneration: 1, status: 'completed', result });
  await expect(preparePlanTaskRequirements(registry, [task.id], [{ taskId: task.id, expectedRevision: 1, description: 'New' }])).rejects.toThrow('completed');
});
