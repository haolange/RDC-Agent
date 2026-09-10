import { describe, expect, it } from 'vitest';
import type { TaskRecord, TaskStatus } from './TaskRegistry';
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

  it('derives blocked from unfinished blockers and keeps explicit statusReason', () => {
    const items = projectTaskItems([
      task('upstream', 'pending', 1, { subject: 'Open capture' }),
      task('downstream', 'pending', 2, { blockedBy: ['upstream'] }),
      task('explicit', 'blocked', 3, { statusReason: 'Waiting for device' }),
    ]);
    expect(items.map((entry) => entry.status)).toEqual(['pending', 'blocked', 'blocked']);
    expect(items[1]?.statusReason).toBe('Open capture');
    expect(items[2]?.statusReason).toBe('Waiting for device');
  });

  it('parses createdAt from task ids and fails closed to 0', () => {
    expect(createdAtFromTaskId('task_1710000000000_abc123')).toBe(1710000000000);
    expect(createdAtFromTaskId('task_retired')).toBe(0);
    expect(createdAtFromTaskId('task_NaN_ff')).toBe(0);
  });
});
