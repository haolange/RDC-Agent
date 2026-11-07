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
async function fixture(verifyArtifact: (uri: string, hash: string) => Promise<boolean> = async () => true,
  verifyEpoch: NonNullable<FileTaskStore['verifyRuntimeEpoch']> = async () => true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'task-requirements-')); roots.push(root);
  let approved: PlanTaskRequirement[] = [];
  const store = new FileTaskStore(root, async () => approved, verifyArtifact, verifyEpoch);
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
const sourceArtifact = { uri: 'session://tool-outputs/findings.json', hash: 'd'.repeat(64) };
const sourceResult = { ...result, resultRef: sourceArtifact.uri, resultHash: sourceArtifact.hash };
const reviewPreparation = (sessionId = 'reviewer') => ({ ...preparation(sessionId), inputArtifacts: [sourceArtifact] });

it('does not settle a review source until its exact result artifact is verifiable', async () => {
  const { registry } = await fixture(async (uri, hash) => uri === sourceArtifact.uri && hash === sourceArtifact.hash);
  const source = await registry.createTask('Generate findings');
  const review = await registry.createTask('Independent review', { blockedBy: [source.id],
    executionRequirements: { ...delegated, independentOfTaskIds: [source.id] } });
  const execution = await registry.startExecution(source.id, { mode: 'direct', preparation: preparation('parent') });
  await expect(registry.settleExecution(execution.id, { expectedGeneration: 1, status: 'completed', result }))
    .rejects.toThrow('requires resultRef and resultHash');
  await expect(registry.settleExecution(execution.id, { expectedGeneration: 1, status: 'completed',
    result: { ...sourceResult, resultHash: 'e'.repeat(64) } })).rejects.toThrow('cannot be verified');
  expect(await registry.getExecution(execution.id)).toMatchObject({ status: 'running', generation: 1 });
  expect(await registry.canStart(review.id)).toBe(false);
  await registry.settleExecution(execution.id, { expectedGeneration: 1, status: 'completed', result: sourceResult });
  expect(await registry.canStart(review.id)).toBe(true);
  const reviewer = await registry.startExecution(review.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'] });
  await registry.bindExecutionPreparation(reviewer.id, 1, reviewPreparation());
  expect((await registry.getExecution(reviewer.id))?.independentSources?.[0]).toMatchObject({
    executionId: execution.id, resultRef: sourceArtifact.uri, resultHash: sourceArtifact.hash });
});

it('reexecutes a completed source lacking a structured result after a review is added', async () => {
  const { registry } = await fixture();
  const source = await registry.createTask('Generate findings');
  const first = await registry.startExecution(source.id, { mode: 'direct', preparation: preparation('parent'),
    budget: { toolCalls: 2, maxToolCalls: 8 } });
  await registry.settleExecution(first.id, { expectedGeneration: 1, status: 'completed', result });
  const review = await registry.createTask('Independent review', { blockedBy: [source.id],
    executionRequirements: { ...delegated, independentOfTaskIds: [source.id] } });
  expect(await registry.canStart(review.id)).toBe(false);
  await expect(registry.updateTask(source.id, { status: 'completed', result: sourceResult }))
    .rejects.toThrow('start a new execution');
  const projected = await registry.readConsistentSnapshot();
  expect(projected.tasks.find(item => item.id === source.id)?.status).toBe('blocked');
  const second = await registry.startExecution(source.id, { mode: 'direct', preparation: preparation('parent') });
  expect(second).toMatchObject({ generation: 2, budget: { toolCalls: 2, maxToolCalls: 8 } });
  await registry.settleExecution(second.id, { expectedGeneration: 2, status: 'completed', result: sourceResult });
  expect((await registry.getExecution(first.id))?.result).toEqual(result);
  expect(await registry.canStart(review.id)).toBe(true);
});

it('distinguishes the runtime fingerprint from full artifact and method hashes', () => {
  expect(TaskExecutionPreparationSchema.parse(preparation()).runtimeFingerprint).toHaveLength(24);
  expect(() => TaskExecutionPreparationSchema.parse({ ...preparation(), runtimeFingerprint: 'a'.repeat(64) })).toThrow();
  expect(() => TaskExecutionPreparationSchema.parse({ ...preparation(), capsuleHash: 'b'.repeat(24) })).toThrow();
  expect(() => TaskExecutionPreparationSchema.parse({ ...preparation(), skills: [{ id: 'method', hash: 'c'.repeat(24) }] })).toThrow();
});

it('appends signed runtime epochs to current direct work without rewriting preparation or budget', async () => {
  let authentic = true;
  const { registry } = await fixture(async () => true, async () => authentic);
  const task = await registry.createTask('Compare captures');
  const run = await registry.startExecution(task.id, { mode: 'direct', preparation: preparation('owner'),
    frozenPlanRef: 'turn:turn:generation:4', budget: { toolCalls: 3, maxToolCalls: 8 } });
  const epoch = { previousFingerprint: 'a'.repeat(24), runtimeFingerprint: 'b'.repeat(24),
    receipt: { uri: 'session://tool-outputs/transition.json', expectedHash: `sha256:${'c'.repeat(64)}` }, recordedAt: 10 };
  expect(await registry.appendRuntimeEpochForTurn('turn', 4, epoch)).toBe(1);
  expect(await registry.appendRuntimeEpochForTurn('turn', 4, epoch)).toBe(0);
  expect(await registry.getExecution(run.id)).toMatchObject({ preparation: preparation('owner'), runtimeEpochs: [epoch],
    budget: { toolCalls: 3, maxToolCalls: 8 } });
  await expect(registry.appendRuntimeEpochForTurn('turn', 4, { ...epoch, runtimeFingerprint: 'd'.repeat(24) })).rejects.toThrow('invalid or unsigned');
  authentic = false;
  await expect(registry.settleExecution(run.id, { expectedGeneration: 1, status: 'completed', result })).rejects.toThrow('signed owning-turn receipt');
  authentic = true;
  await registry.settleExecution(run.id, { expectedGeneration: 1, status: 'completed', result });
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

it('binds a Task to the actual prepared Agent and its model provenance', async () => {
  const { registry } = await fixture();
  const task = await registry.createTask('Review', { executionRequirements: { ...delegated, profileId: 'verifier' } });
  await expect(registry.startExecution(task.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'], requestedProfileId: 'generator' }))
    .rejects.toThrow('requires profile verifier');
  const execution = await registry.startExecution(task.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'], requestedProfileId: 'verifier' });
  await expect(registry.bindExecutionPreparation(execution.id, execution.generation, preparation())).rejects.toThrow('does not prove');
  const prepared = {
    ...preparation(), profileId: 'verifier', profileSourceHash: 'c'.repeat(64), providerId: 'provider', modelId: 'model', reasoningLevel: 'high',
    profileSource: { scope: 'user', path: '/user/agents/verifier.agent.md' },
  } as const;
  await expect(registry.bindExecutionPreparation(execution.id, execution.generation, { ...prepared, profileSource: undefined })).rejects.toThrow('does not prove');
  await expect(registry.bindExecutionPreparation(execution.id, execution.generation, { ...prepared, reasoningLevel: 'unknown' })).rejects.toThrow('does not prove');
  await registry.bindExecutionPreparation(execution.id, execution.generation, prepared);
});

it('checks independent context, source execution and absence of inherited domain capabilities', async () => {
  const { registry } = await fixture();
  const source = await registry.createTask('Generate findings');
  const sourceExecution = await registry.startExecution(source.id, { mode: 'direct', preparation: preparation('parent') });
  await registry.settleExecution(sourceExecution.id, { expectedGeneration: 1, status: 'completed', result: sourceResult });
  const review = await registry.createTask('Independent review', { executionRequirements: { ...delegated, independentOfTaskIds: [source.id] } });
  const execution = await registry.startExecution(review.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'] });
  for (const input of [preparation('parent'), { ...preparation(), selectedTurnCount: 1 }, { ...preparation(), selectedTurnCount: null }, { ...preparation(), requestsDomainCapability: true }]) {
    await expect(registry.bindExecutionPreparation(execution.id, 1, input)).rejects.toThrow('TASK_EXECUTION_REQUIREMENTS');
  }
  await expect(registry.bindExecutionPreparation(execution.id, 1, preparation('reviewer'))).rejects.toThrow('authorized source result');
  await registry.bindExecutionPreparation(execution.id, 1, reviewPreparation());
  await expect(registry.bindExecutionPreparation(execution.id, 1, reviewPreparation('another-reviewer'))).rejects.toThrow('immutable');
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
  await expect(registry.bindExecutionPreparation(execution.id, 1, reviewPreparation())).rejects.toThrow('settled');
  await registry.settleExecution(first.id, { expectedGeneration: 1, status: 'partial', result: { ...sourceResult, disposition: 'partial' } });
  await registry.bindExecutionPreparation(execution.id, 1, reviewPreparation());
  expect((await registry.getExecution(execution.id))?.independentSources).toEqual([{ taskId: source.id, executionId: first.id, generation: 1, taskRevision: 1, resultRef: sourceArtifact.uri, resultHash: sourceArtifact.hash }]);
  await registry.startExecution(source.id, { mode: 'direct', preparation: preparation('parent-next') });
  await expect(registry.settleExecution(execution.id, { expectedGeneration: 1, status: 'completed', result })).rejects.toThrow('settled');
});

it('rechecks the reviewed artifact when settling and when closing an approved goal', async () => {
  let current = true;
  const { registry, approve } = await fixture(async (uri, hash) => current && uri === sourceArtifact.uri && hash === sourceArtifact.hash);
  const source = await registry.createTask('Generate findings');
  const generated = await registry.startExecution(source.id, { mode: 'direct', preparation: preparation('parent') });
  await registry.settleExecution(generated.id, { expectedGeneration: 1, status: 'completed', result: sourceResult });
  const review = await registry.createTask('Review findings', { executionRequirements: { ...delegated, independentOfTaskIds: [source.id] } });
  const first = await registry.startExecution(review.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'] });
  await registry.bindExecutionPreparation(first.id, 1, reviewPreparation());
  current = false;
  await expect(registry.settleExecution(first.id, { expectedGeneration: 1, status: 'completed', result })).rejects.toThrow('no longer current');
  current = true;
  await registry.settleExecution(first.id, { expectedGeneration: 1, status: 'completed', result });
  approve([snapshotTaskRequirement((await registry.getTask(review.id))!)]);
  await registry.assertApprovedTasksCompleted();
  current = false;
  await expect(registry.assertApprovedTasksCompleted()).rejects.toThrow('no longer current');
});

it('reexecutes only invalidated source and review Tasks, preserving their history and budget', async () => {
  const nextArtifact = { uri: 'session://tool-outputs/findings-next.json', hash: 'e'.repeat(64) };
  let live = sourceArtifact;
  const { registry, approve } = await fixture(async (uri, hash) => uri === live.uri && hash === live.hash);
  const source = await registry.createTask('Generate findings');
  const generated = await registry.startExecution(source.id, { mode: 'direct', preparation: preparation('parent'), budget: { toolCalls: 4, maxToolCalls: 10 } });
  await registry.settleExecution(generated.id, { expectedGeneration: 1, status: 'completed', result: sourceResult });
  const review = await registry.createTask('Review findings', { executionRequirements: { ...delegated, independentOfTaskIds: [source.id] } });
  const reviewed = await registry.startExecution(review.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'], budget: { toolCalls: 3, maxToolCalls: 8 } });
  await registry.bindExecutionPreparation(reviewed.id, 1, reviewPreparation());
  await registry.settleExecution(reviewed.id, { expectedGeneration: 1, status: 'completed', result });
  const dependent = await registry.createTask('Use reviewed findings', { blockedBy: [review.id] });
  expect(await registry.canStart(dependent.id)).toBe(true);
  approve([snapshotTaskRequirement((await registry.getTask(source.id))!), snapshotTaskRequirement((await registry.getTask(review.id))!)]);
  await expect(registry.startExecution(source.id, { mode: 'direct', preparation: preparation('parent') })).rejects.toThrow('Terminal task');
  await expect(registry.startExecution(review.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'] })).rejects.toThrow('Terminal task');

  live = nextArtifact;
  expect(await registry.canStart(dependent.id)).toBe(false);
  const next = await registry.startExecution(source.id, { mode: 'direct', preparation: preparation('parent-next'), budget: { toolCalls: 0, maxToolCalls: 100 } });
  expect(next).toMatchObject({ generation: 2, budget: { toolCalls: 4, maxToolCalls: 10 } });
  await registry.settleExecution(next.id, { expectedGeneration: 2, status: 'completed', result: { ...result, resultRef: live.uri, resultHash: live.hash } });
  await expect(registry.assertApprovedTasksCompleted()).rejects.toThrow('changed after review preparation');
  const rereview = await registry.startExecution(review.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'], budget: { toolCalls: 0, maxToolCalls: 100 } });
  expect(rereview).toMatchObject({ generation: 2, budget: { toolCalls: 3, maxToolCalls: 8 } });
  await registry.bindExecutionPreparation(rereview.id, 2, { ...preparation('reviewer-next'), inputArtifacts: [live] });
  await registry.settleExecution(rereview.id, { expectedGeneration: 2, status: 'completed', result });
  await registry.assertApprovedTasksCompleted();
  expect(await registry.canStart(dependent.id)).toBe(true);
  expect((await registry.getExecution(generated.id))?.result).toEqual(sourceResult);
  expect((await registry.getExecution(reviewed.id))?.independentSources?.[0]?.resultHash).toBe(sourceArtifact.hash);
});

it('revalidates and repairs stale review work inside a completed parent without rerunning unrelated work', async () => {
  const nextArtifact = { uri: 'session://tool-outputs/findings-next.json', hash: 'e'.repeat(64) };
  let live = sourceArtifact;
  const { registry, approve } = await fixture(async (uri, hash) => uri === live.uri && hash === live.hash);
  const parent = await registry.createTask('Investigation');
  const parentRun = await registry.startExecution(parent.id, { mode: 'direct' });
  const source = await registry.createTask('Findings', { parentTaskId: parent.id });
  const generated = await registry.startExecution(source.id, { mode: 'direct', preparation: preparation('parent') });
  await registry.settleExecution(generated.id, { expectedGeneration: 1, status: 'completed', result: sourceResult });
  const review = await registry.createTask('Review', { parentTaskId: parent.id, executionRequirements: { ...delegated, independentOfTaskIds: [source.id] } });
  const reviewed = await registry.startExecution(review.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'] });
  await registry.bindExecutionPreparation(reviewed.id, 1, reviewPreparation());
  await registry.settleExecution(reviewed.id, { expectedGeneration: 1, status: 'completed', result });
  await registry.settleExecution(parentRun.id, { expectedGeneration: 1, status: 'completed', result });
  const dependent = await registry.createTask('Use investigation', { blockedBy: [parent.id] });
  approve([snapshotTaskRequirement((await registry.getTask(parent.id))!)]);
  await registry.assertApprovedTasksCompleted();
  expect(await registry.canStart(dependent.id)).toBe(true);

  live = nextArtifact;
  await expect(registry.assertApprovedTasksCompleted()).rejects.toThrow(/current|changed/i);
  expect(await registry.canStart(dependent.id)).toBe(false);
  const stale = await registry.readConsistentSnapshot();
  expect(stale.tasks.find(task => task.id === parent.id)).toMatchObject({ status: 'blocked' });
  expect(stale.tasks.find(task => task.id === review.id)).toMatchObject({ status: 'blocked' });
  const listing = await createTaskTools(registry).find(tool => tool.name === 'task_list')!.execute('list', {} as never);
  expect(listing.content[0]).toMatchObject({ text: expect.stringContaining('Completion requires revalidation') });
  await expect(registry.createTask('Unrelated new work', { parentTaskId: parent.id })).rejects.toThrow(/terminal/);
  await expect(registry.startExecution(parent.id, { mode: 'direct' })).rejects.toThrow(/Terminal/);

  const interrupted = await registry.startExecution(source.id, { mode: 'direct', preparation: preparation('parent-next') });
  await registry.settleExecution(interrupted.id, { expectedGeneration: 2, status: 'partial', result: { ...result, disposition: 'partial' } });
  const next = await registry.startExecution(source.id, { mode: 'direct', preparation: preparation('parent-retry') });
  await registry.settleExecution(next.id, { expectedGeneration: 3, status: 'completed', result: { ...result, resultRef: live.uri, resultHash: live.hash } });
  const rereview = await registry.startExecution(review.id, { mode: 'subagent', requiredSkillIds: ['analysis-method'] });
  await registry.bindExecutionPreparation(rereview.id, 2, { ...preparation('reviewer-next'), inputArtifacts: [live] });
  await registry.settleExecution(rereview.id, { expectedGeneration: 2, status: 'completed', result });
  await registry.assertApprovedTasksCompleted();
  expect(await registry.canStart(dependent.id)).toBe(true);
  expect((await registry.readConsistentSnapshot()).tasks.find(task => task.id === parent.id)).toMatchObject({ status: 'completed' });
  expect((await registry.listExecutions(parent.id))).toHaveLength(1);
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
