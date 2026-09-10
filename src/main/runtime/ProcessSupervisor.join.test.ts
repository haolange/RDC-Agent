import { afterEach, describe, expect, it, vi } from 'vitest';

const childState = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const child = {
    pid: 42,
    killed: false,
    stdout: { on: () => child.stdout },
    stderr: { on: () => child.stderr },
    on: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
      return child;
    },
    emit: (event: string, ...args: unknown[]) => {
      listeners.get(event)?.(...args);
    },
    kill: () => {
      child.killed = true;
      return true;
    },
  };
  return {
    child,
    spawn: vi.fn(() => child),
    spawnSync: vi.fn(),
  };
});

vi.mock('child_process', () => ({
  spawn: childState.spawn,
  spawnSync: childState.spawnSync,
}));

import { withProcessExecutionOwner } from './ResourceExecutionLifetime';
import { ToolResourceArbiter } from '../workflow/debugger/ToolResourceArbiter';
import { ProcessSupervisor } from './ProcessSupervisor';

describe('ProcessSupervisor bounded join', () => {
  afterEach(() => {
    childState.child.emit('close', 0, null);
    childState.child.killed = false;
    childState.spawn.mockClear();
    childState.spawnSync.mockClear();
  });

  it('returns unconfirmed_orphan when forced termination has no close event', async () => {
    const supervisor = new ProcessSupervisor();
    const supervised = await withProcessExecutionOwner('parent::subagent::child', async () => supervisor.spawn('other', 'fake-command', [], { isolateProcessGroup: false }));

    const arbiter = new ToolResourceArbiter();
    const info = await arbiter.runExclusive('project', undefined, () => supervised.join(1));
    await expect(arbiter.runExclusive('project', undefined, async () => 'bad')).rejects.toThrow('quarantined');
    expect(info.reason).toBe('unconfirmed_orphan');
    expect(supervised.orphaned).toBe(true);
    expect(supervisor.size).toBe(1);
    expect(supervisor.hasUnconfirmedProcesses('parent::subagent::child')).toBe(true);
    expect(supervisor.hasUnconfirmedProcesses('other-child')).toBe(false);
    let joined = false;
    const join = supervisor.joinExecutionProcesses('parent::subagent::child').then(() => { joined = true; });
    await Promise.resolve();
    expect(joined).toBe(false);

    childState.child.emit('close', 0, null);
    await expect(supervised.exit).resolves.toMatchObject({ reason: 'timeout' });
    expect(supervisor.size).toBe(0);
    await join;
    expect(joined).toBe(true);
    expect(supervisor.hasUnconfirmedProcesses('parent::subagent::child')).toBe(false);
    await new Promise((resolve) => setImmediate(resolve));
    await expect(arbiter.runExclusive('project', undefined, async () => 'recovered')).resolves.toBe('recovered');
  }, 10_000);
});
