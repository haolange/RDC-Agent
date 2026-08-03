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
    const supervised = supervisor.spawn('other', 'fake-command', [], { isolateProcessGroup: false });

    const info = await supervised.join(1);
    expect(info.reason).toBe('unconfirmed_orphan');
    expect(supervised.orphaned).toBe(true);
    expect(supervisor.size).toBe(1);

    childState.child.emit('close', 0, null);
    await expect(supervised.exit).resolves.toMatchObject({ reason: 'timeout' });
    expect(supervisor.size).toBe(0);
  }, 10_000);
});
