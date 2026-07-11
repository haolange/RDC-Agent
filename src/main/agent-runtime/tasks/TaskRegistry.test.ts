import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskRegistry } from './TaskRegistry';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function createRegistry(): Promise<TaskRegistry> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rdx-tasks-'));
  roots.push(dir);
  return new TaskRegistry(dir);
}

describe('TaskRegistry', () => {
  it('supports create / get / list / update CRUD', async () => {
    const registry = await createRegistry();
    const created = await registry.createTask('Implement login', {
      description: 'Wire auth endpoints',
      activeForm: 'Implementing login',
    });
    expect(created.id).toMatch(/^task_/);
    expect(created.status).toBe('pending');
    expect(created.subject).toBe('Implement login');

    const loaded = await registry.getTask(created.id);
    expect(loaded).toMatchObject({ id: created.id, subject: 'Implement login' });

    const updated = await registry.updateTask(created.id, {
      status: 'in_progress',
      subject: 'Implement login API',
    });
    expect(updated.status).toBe('in_progress');
    expect(updated.subject).toBe('Implement login API');

    const listed = await registry.listTasks();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
  });

  it('maintains bidirectional blockedBy / blocks links', async () => {
    const registry = await createRegistry();
    const upstream = await registry.createTask('Upstream');
    const downstream = await registry.createTask('Downstream', {
      blockedBy: [upstream.id],
    });

    const refreshedUpstream = await registry.getTask(upstream.id);
    expect(downstream.blockedBy).toEqual([upstream.id]);
    expect(refreshedUpstream?.blocks).toEqual([downstream.id]);
  });

  it('unlocks pending dependents when blocker completes', async () => {
    const registry = await createRegistry();
    const a = await registry.createTask('A');
    const b = await registry.createTask('B', { blockedBy: [a.id] });

    expect(await registry.canStart(b.id)).toBe(false);
    await registry.updateTask(a.id, { status: 'completed' });
    expect(await registry.canStart(b.id)).toBe(true);

    const unblocked = await registry.getUnblockedTasks(a.id);
    expect(unblocked.map((task) => task.id)).toEqual([b.id]);
  });

  it('rejects dependency cycles on update addBlockedBy', async () => {
    const registry = await createRegistry();
    const a = await registry.createTask('A');
    const b = await registry.createTask('B', { blockedBy: [a.id] });

    await expect(registry.updateTask(a.id, { addBlockedBy: [b.id] })).rejects.toThrow(/依赖环/);
  });

  it('rejects self-dependency cycles', async () => {
    const registry = await createRegistry();
    const a = await registry.createTask('A');
    await expect(registry.updateTask(a.id, { addBlockedBy: [a.id] })).rejects.toThrow(/自身/);
  });

  it('rejects cycles introduced via addBlocks', async () => {
    const registry = await createRegistry();
    const a = await registry.createTask('A');
    const b = await registry.createTask('B', { blockedBy: [a.id] });

    await expect(registry.updateTask(b.id, { addBlocks: [a.id] })).rejects.toThrow(/依赖环/);
  });

  it('rejects empty subject', async () => {
    const registry = await createRegistry();
    await expect(registry.createTask('   ')).rejects.toThrow(/subject/);
  });
});
