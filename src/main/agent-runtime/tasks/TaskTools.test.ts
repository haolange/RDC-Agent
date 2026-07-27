import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskRegistry } from './TaskRegistry';
import { createTaskTools } from './TaskTools';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const first = result.content[0];
  return first?.type === 'text' ? (first.text ?? '') : '';
}

describe('TaskTools', () => {
  it('executes all five task tools', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdx-task-tools-'));
    roots.push(dir);
    const registry = new TaskRegistry(dir);
    const tools = createTaskTools(registry);
    expect(tools.map((tool) => tool.name)).toEqual([
      'task_create',
      'task_update',
      'task_get',
      'task_list',
      'task_stop',
    ]);

    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

    const created = await byName.task_create!.execute('c1', {
      subject: 'Ship feature',
      description: 'End-to-end',
    });
    expect(textOf(created)).toContain('Created');
    const taskId = (created.details as { id: string }).id;

    const listed = await byName.task_list!.execute('l1', {});
    expect(textOf(listed)).toContain(taskId);
    expect((listed.details as { count: number }).count).toBe(1);

    const got = await byName.task_get!.execute('g1', { taskId });
    expect(textOf(got)).toContain('Ship feature');
    expect((got.details as { found: boolean }).found).toBe(true);

    const updated = await byName.task_update!.execute('u1', {
      taskId,
      status: 'in_progress',
    });
    expect(textOf(updated)).toContain('in_progress');

    const stopped = await byName.task_stop!.execute('s1', { taskId });
    expect(textOf(stopped)).toContain('Stopped');
    expect((await registry.getTask(taskId))?.status).toBe('cancelled');
    expect(byName.task_stop!.description).toContain('Stop/cancel by marking cancelled');
  });
});
