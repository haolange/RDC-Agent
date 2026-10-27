import { describe, expect, it } from 'vitest';
import type { TaskRecord, TaskStatus } from './TaskRegistry';
import type { TaskExecutionRecord } from './TaskContracts';
import { TASK_SCHEMA_VERSION } from './TaskContracts';
import { createdAtFromTaskId, orderTasks, projectTaskItems } from './taskProjection';

const task = (
  id: string,
  status: TaskStatus,
  createdAt: number,
  extras: Partial<TaskRecord> = {},
): TaskRecord => ({
  schemaVersion: TASK_SCHEMA_VERSION,
  id,
  subject: extras.subject ?? id,
  description: '',
  status,
  statusReason: extras.statusReason,
  blockedBy: extras.blockedBy ?? [],
  blocks: extras.blocks ?? [],
  completionRequirements: [],
  executionRequired: true,
  executionIds: [],
  revision: 1,
  createdAt,
  updatedAt: extras.updatedAt ?? createdAt,
});

describe('taskProjection', () => {
  it('orders by createdAt then id and assigns stable order', () => {
    const ordered = orderTasks([
      task('task_2', 'pending', 20),
      task('task_1b', 'completed', 10),
      task('task_1a', 'pending', 10),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(['task_1a', 'task_1b', 'task_2']);
    expect(projectTaskItems(ordered).map((entry) => entry.order)).toEqual([0, 1, 2]);
  });

  it('keeps dependency waits pending and preserves real blocker reasons', () => {
    const items = projectTaskItems([
      task('upstream', 'pending', 1, { subject: 'Open capture' }),
      task('downstream', 'pending', 2, { blockedBy: ['upstream'] }),
      task('explicit', 'blocked', 3, { statusReason: 'Waiting for device' }),
    ]);
    expect(items.map((entry) => entry.status)).toEqual(['pending', 'pending', 'blocked']);
    expect(items[1]?.statusReason).toBeUndefined();
    expect(items[1]?.waitingOn).toEqual([{ taskId: 'upstream', title: 'Open capture', reason: 'unfinished' }]);
    expect(items[2]?.statusReason).toBe('Waiting for device');
  });

  it('does not mistake a completed label without verified proof for satisfied dependencies', () => {
    const upstream = { ...task('upstream', 'completed', 1), disposition: 'completed' as const };
    const [_, downstream] = projectTaskItems([upstream, task('next', 'pending', 2, { blockedBy: ['upstream', 'missing'] })]);
    expect(downstream.status).toBe('pending');
    expect(downstream.waitingOn).toEqual([
      { taskId: 'upstream', title: 'upstream', reason: 'unverified' },
      { taskId: 'missing', reason: 'missing' },
    ]);
  });

  it('parses createdAt from task ids and fails closed to 0', () => {
    expect(createdAtFromTaskId('task_1710000000000_abc123')).toBe(1710000000000);
    expect(createdAtFromTaskId('task_retired')).toBe(0);
    expect(createdAtFromTaskId('task_NaN_ff')).toBe(0);
  });
});

it.each(['blocked', 'cancelled', 'in_progress'] as const)('keeps downstream pending when its prerequisite is %s', status => {
  const items = projectTaskItems([task('a', status, 1), task('b', 'pending', 2, { blockedBy: ['a'] })]);
  expect(items[1]).toMatchObject({ status: 'pending', waitingOn: [{ taskId: 'a', reason: 'unfinished' }] });
});
it('uses current execution proof without changing task lifecycle or clearing a real block', () => {
  const upstream = { ...task('a', 'completed', 1), disposition: 'completed' as const, currentExecutionId: 'exec' };
  const proof = { id: 'exec', taskId: 'a', taskRevision: 1, status: 'completed', result: { disposition: 'completed' } } as TaskExecutionRecord;
  const next = task('b', 'pending', 2, { blockedBy: ['a'] });
  expect(projectTaskItems([upstream, next], [proof])[1]).toMatchObject({ status: 'pending' });
  expect(projectTaskItems([upstream, next], [proof])[1].waitingOn).toBeUndefined();
  for (const invalid of [{ ...proof, taskRevision: 2 }, { ...proof, taskId: 'other' }, { ...proof, status: 'failed' as const }]) {
    expect(projectTaskItems([upstream, next], [invalid])[1].waitingOn?.[0].reason).toBe('unverified');
  }
  expect(projectTaskItems([upstream, { ...next, status: 'blocked', statusReason: 'Own blocker' }], [proof])[1])
    .toMatchObject({ status: 'blocked', statusReason: 'Own blocker' });
});
