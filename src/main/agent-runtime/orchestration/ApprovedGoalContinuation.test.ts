import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { FileTaskStore, TaskRegistry } from '../tasks';
import { snapshotTaskRequirement } from '../tasks/TaskExecutionRequirements';
import { MissionCompletionError } from '../../investigation/missionCompletionContract';
import { createApprovedGoalContinuation } from './ApprovedGoalContinuation';
import { listActiveDelegations } from './DirectTaskTurnLifecycle';
import { TurnHandle } from './TurnCoordinator';
import type { PlanTaskRequirement } from '@shared/types/taskExecution';

vi.mock('./DirectTaskTurnLifecycle', () => ({ listActiveDelegations: vi.fn(async () => []) }));

const roots: string[] = [];
afterEach(async () => {
  vi.mocked(listActiveDelegations).mockReset().mockResolvedValue([]);
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'approved-goal-continuation-'));
  roots.push(root);
  let approved: PlanTaskRequirement[] = [];
  const registry = new TaskRegistry(new FileTaskStore(root, async () => approved));
  const turn = new TurnHandle({ sessionKey: randomUUID(), turnId: randomUUID(), generation: 1 });
  return { registry, turn, approve: (tasks: PlanTaskRequirement[]) => { approved = tasks; } };
}

it('reassesses an incomplete approved Task once per execution without changing consumption', async () => {
  const { registry, turn, approve } = await fixture();
  const task = await registry.createTask('Resolve the approved question');
  approve([snapshotTaskRequirement(task)]);
  const deadlineAt = Date.now() + 60_000;
  const first = await registry.startExecution(task.id, { mode: 'direct', budget: { toolCalls: 3, maxToolCalls: 9, deadlineAt } });
  await registry.settleExecution(first.id, { expectedGeneration: 1, status: 'blocked',
    result: { disposition: 'blocked', summary: 'One branch is unverified.', outputs: {} } });
  const check = createApprovedGoalContinuation(turn, 'session', registry);
  const declaration = { disposition: 'partial' as const, evidenceRefs: [] };
  turn.completionDeclaration = declaration;
  const feedback = await check();
  expect(feedback).toContain(task.id);
  expect(feedback).toContain('One branch is unverified.');
  expect(feedback).toMatch(/do not repeat/iu);
  expect(feedback).toContain('perform the next check now');
  expect(feedback).toContain('reread the frozen plan');
  expect(turn.completionDeclaration).toBe(declaration);
  expect((await registry.getExecution(first.id))?.budget).toMatchObject({ toolCalls: 3, maxToolCalls: 9, deadlineAt });

  expect(await check()).toBeUndefined();
  expect(turn.completionDeclaration).toBe(declaration);

  const second = await registry.startExecution(task.id, { mode: 'direct' });
  expect(second.budget).toMatchObject({ toolCalls: 3, maxToolCalls: 9, deadlineAt });
  await registry.settleExecution(second.id, { expectedGeneration: 2, status: 'blocked',
    result: { disposition: 'blocked', summary: 'A different condition is unavailable.', outputs: {} } });
  turn.completionDeclaration = { disposition: 'blocked', evidenceRefs: [] };
  expect(await check()).toContain('A different condition is unavailable.');
});

it('requires a new declaration after further tool work but accepts a new declaration', async () => {
  const { registry, turn, approve } = await fixture();
  const task = await registry.createTask('Approved work');
  approve([snapshotTaskRequirement(task)]);
  const check = createApprovedGoalContinuation(turn, 'session', registry);
  turn.completionDeclaration = { disposition: 'partial', evidenceRefs: [] };
  expect(await check()).toContain('Approved Goal Reassessment');
  turn.policyBudget.toolCalls++;
  expect(await check()).toContain('Incomplete Approved Obligation');
  expect(turn.completionDeclaration).toBeNull();

  const updated = { disposition: 'partial' as const, evidenceRefs: [] };
  turn.completionDeclaration = updated;
  expect(await check()).toBeUndefined();
  expect(turn.completionDeclaration).toBe(updated);
});

it('reassesses an unresolved partial goal after its approved Tasks settle', async () => {
  const { registry, turn, approve } = await fixture();
  const task = await registry.createTask('Review the approved result');
  approve([snapshotTaskRequirement(task)]);
  const execution = await registry.startExecution(task.id, { mode: 'direct' });
  await registry.settleExecution(execution.id, { expectedGeneration: 1, status: 'completed',
    result: { disposition: 'completed', summary: 'Review done.', outputs: {} } });
  const check = createApprovedGoalContinuation(turn, 'session', registry);
  const declaration = { disposition: 'partial' as const, evidenceRefs: [{ uri: 'session://tool-outputs/result.json', hash: 'a'.repeat(64) }],
    result: { summary: 'One claim still needs revision.', outputs: {}, counterevidence: [], unresolved: ['Revise the claim.'],
      scope: 'approved goal', sideEffects: [], recoveryState: [] } };
  turn.completionDeclaration = declaration;
  expect(await check()).toContain('approved Tasks are settled');
  expect(turn.completionDeclaration).toBe(declaration);
  expect(await check()).toBeUndefined();
  turn.completionDeclaration = { ...declaration };
  expect(await check()).toBeUndefined();

  turn.completionDeclaration = { ...declaration, evidenceRefs: [{ uri: 'session://tool-outputs/result.json', hash: 'b'.repeat(64) }] };
  expect(await check()).toContain('approved Tasks are settled');
  turn.policyBudget.toolCalls++;
  expect(await check()).toContain('Declare the approved goal disposition');
  expect(turn.completionDeclaration).toBeNull();
  turn.completionDeclaration = { ...declaration, disposition: 'blocked' };
  expect(await check()).toBeUndefined();
});

it('keeps a replacement declaration made during reassessment', async () => {
  const { registry, turn, approve } = await fixture();
  const task = await registry.createTask('Approved work');
  approve([snapshotTaskRequirement(task)]);
  const check = createApprovedGoalContinuation(turn, 'session', registry);
  turn.completionDeclaration = { disposition: 'partial', evidenceRefs: [] };
  expect(await check()).toContain('Approved Goal Reassessment');
  turn.policyBudget.toolCalls++;
  const updated = { disposition: 'blocked' as const, evidenceRefs: [] };
  turn.completionDeclaration = updated;
  expect(await check()).toBeUndefined();
  expect(turn.completionDeclaration).toBe(updated);
});

it('invalidates a declaration when its report reference or other completion conditions fail', async () => {
  const { registry, turn } = await fixture();
  const check = createApprovedGoalContinuation(turn, 'session', registry);
  turn.completionDeclaration = { disposition: 'completed', evidenceRefs: [] };
  expect(await check(() => { throw new MissionCompletionError('report_not_bound', 'Missing reference.'); }))
    .toContain('call turn_complete again');
  expect(turn.completionDeclaration).toBeNull();

  turn.completionDeclaration = { disposition: 'completed', evidenceRefs: [] };
  expect(await check(() => { throw new MissionCompletionError('open_challenge', 'Challenge remains open.'); }))
    .toContain('call turn_complete again');
  expect(turn.completionDeclaration).toBeNull();
});

it('preserves cancellation, explicit limits and pending handoffs', async () => {
  const { registry, turn, approve } = await fixture();
  const task = await registry.createTask('Approved work');
  approve([snapshotTaskRequirement(task)]);
  const check = createApprovedGoalContinuation(turn, 'session', registry);
  turn.completionDeclaration = { disposition: 'cancelled', evidenceRefs: [] };
  expect(await check()).toBeUndefined();
  turn.completionDeclaration = { disposition: 'budget_paused', evidenceRefs: [] };
  expect(await check()).toBeUndefined();
  for (const remaining of [1, 2]) {
    turn.providerLoopBudget = { remaining, limit: 5 };
    turn.completionDeclaration = { disposition: 'partial', evidenceRefs: [] };
    expect(await check()).toBeUndefined();
    expect(turn.completionDeclaration?.disposition).toBe('partial');
  }
  turn.providerLoopBudget = null;
  turn.pendingHandoff = { turnId: turn.turnId, fromAgentId: 'general', toProfile: 'debugger', prompt: '', label: '' };
  turn.completionDeclaration = { disposition: 'blocked', evidenceRefs: [] };
  expect(await check()).toBeUndefined();
  turn.pendingHandoff = null;
  await turn.abortAndJoin({ reason: 'user_stop' });
  expect(await check()).toBeUndefined();
});

it('leaves an active background delegation and unrelated work alone', async () => {
  const { registry, turn, approve } = await fixture();
  const task = await registry.createTask('Approved work');
  approve([snapshotTaskRequirement(task)]);
  const execution = await registry.startExecution(task.id, { mode: 'subagent' });
  vi.mocked(listActiveDelegations).mockResolvedValue([execution]);
  const check = createApprovedGoalContinuation(turn, 'session', registry);
  turn.completionDeclaration = { disposition: 'partial', evidenceRefs: [] };
  expect(await check()).toBeUndefined();
  expect(turn.completionDeclaration?.disposition).toBe('partial');

  vi.mocked(listActiveDelegations).mockResolvedValue([]);
  approve([]);
  expect(await check()).toBeUndefined();
});

it('does not hide errors reading the approved Task state', async () => {
  const { registry, turn } = await fixture();
  vi.spyOn(registry, 'assertApprovedTasksCompleted').mockRejectedValue(new Error('storage unavailable'));
  const check = createApprovedGoalContinuation(turn, 'session', registry);
  turn.completionDeclaration = { disposition: 'partial', evidenceRefs: [] };
  await expect(check()).rejects.toThrow('storage unavailable');
});

it('reports a changed approved requirement once while still allowing an honest partial', async () => {
  const { registry, turn } = await fixture();
  vi.spyOn(registry, 'assertApprovedTasksCompleted').mockRejectedValue(new Error('TASK_EXECUTION_REQUIREMENTS: approved Task changed'));
  const check = createApprovedGoalContinuation(turn, 'session', registry);
  turn.completionDeclaration = { disposition: 'partial', evidenceRefs: [] };
  expect(await check()).toContain('approved Task changed');
  turn.completionDeclaration = { disposition: 'partial', evidenceRefs: [] };
  expect(await check()).toBeUndefined();
});

it('restates the recorded frontier and open Challenge follow-ups in a single reassessment', async () => {
  const { registry, turn, approve } = await fixture();
  const task = await registry.createTask('Investigate the approved symptom');
  approve([snapshotTaskRequirement(task)]);
  const execution = await registry.startExecution(task.id, { mode: 'direct' });
  await registry.settleExecution(execution.id, { expectedGeneration: 1, status: 'completed',
    result: { disposition: 'completed', summary: 'Partial evidence.', outputs: {} } });
  const entry = (artifactId: string, kind: string, status: string, createdAt = '2026-11-11T00:00:00Z') =>
    ({ artifactId, kind, status, createdAt });
  const records: Record<string, unknown> = {
    old: { checkpointId: 'cp-old', unresolvedFrontier: 'stale frontier' },
    cp1: { checkpointId: 'cp-1', unresolvedFrontier: 'Read native values around the candidate region.' },
    cp2: { checkpointId: 'cp-2', unresolvedFrontier: 'Confirm which draw covers the candidate region.' },
    ch1: { challengeId: 'ch-1', targetRef: { type: 'claim', id: 'claim-anchor' }, statement: 'Anchor unproven.',
      requiredFollowUp: 'Compare the draw-call overlay with the candidate rectangle.', status: 'open' },
    ch2: { challengeId: 'ch-2', targetRef: { type: 'evidence', id: 'ev-1' }, statement: 'Settled.', status: 'resolved' },
  };
  const index = [entry('old', 'checkpoint', 'superseded', '2026-11-12T00:00:00Z'), entry('cp1', 'checkpoint', 'ready'),
    entry('cp2', 'checkpoint', 'draft', '2026-11-11T01:00:00Z'), entry('ch1', 'challenge', 'ready'), entry('ch2', 'challenge', 'ready')];
  const investigation = {
    list: (_session: string, filter: { kind: string }) => index.filter(item => item.kind === filter.kind),
    readRecord: (_session: string, artifactId: string) => ({ record: records[artifactId] }),
  } as never;
  const check = createApprovedGoalContinuation(turn, 'session', registry, investigation);
  turn.completionDeclaration = { disposition: 'partial', evidenceRefs: [],
    result: { summary: 'Anchor not established.', outputs: {}, counterevidence: [], unresolved: ['Anchor the symptom.'],
      scope: 'approved goal', sideEffects: [], recoveryState: [] } };
  const feedback = await check();
  expect(feedback).toContain('cp-2');
  expect(feedback).toContain('Confirm which draw covers the candidate region.');
  expect(feedback).toContain('ch-1 on claim claim-anchor: Compare the draw-call overlay with the candidate rectangle.');
  expect(feedback).not.toMatch(/stale frontier|cp-1|ch-2/u);
  expect(await check()).toBeUndefined();

  const unreadable = createApprovedGoalContinuation(turn, 'session', registry,
    { list: () => { throw new Error('INVESTIGATION_STORE_CORRUPT: index unreadable'); } } as never);
  expect(await unreadable()).toContain('Recorded investigation work could not be read: INVESTIGATION_STORE_CORRUPT');
});
