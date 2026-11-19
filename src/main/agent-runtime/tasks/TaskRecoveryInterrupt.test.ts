import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { TaskRegistry } from './TaskRegistry';

it('joins the affected child, retains its consumption, and permits the same Task to retry', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-recovery-task-'));
  try {
    let release!: () => void; let entered!: () => void;
    const joined = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const registry = new TaskRegistry(root, { onCancelExecution: async () => { entered(); await joined; } });
    const task = await registry.createTask('Analyze current replay');
    const first = await registry.startExecution(task.id, { mode: 'subagent', budget: { maxToolCalls: 20, toolCalls: 4 } });
    const stopping = registry.interruptExecutionForRecovery(first.id, first.generation); await started;
    expect(await registry.getExecution(first.id)).toMatchObject({ status: 'cancelling', budget: { toolCalls: 4 } });
    await expect(registry.startExecution(task.id, { mode: 'subagent' })).rejects.toThrow();
    release(); await stopping;
    expect(await registry.getExecution(first.id)).toMatchObject({ status: 'interrupted', result: { disposition: 'blocked' } });
    expect(await registry.getTask(task.id)).toMatchObject({ status: 'blocked', disposition: 'blocked' });
    const next = await registry.startExecution(task.id, { mode: 'subagent', budget: { maxToolCalls: 20, toolCalls: 0 } });
    expect(next).toMatchObject({ generation: 2, budget: { maxToolCalls: 20, toolCalls: 4 } });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('does not pretend an unowned child was stopped', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-recovery-task-'));
  try {
    const registry = new TaskRegistry(root); const task = await registry.createTask('Unowned child');
    const execution = await registry.startExecution(task.id, { mode: 'subagent' });
    await expect(registry.interruptExecutionForRecovery(execution.id, execution.generation)).rejects.toThrow('OWNER_MISSING');
    expect(await registry.getExecution(execution.id)).toMatchObject({ status: 'running' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
