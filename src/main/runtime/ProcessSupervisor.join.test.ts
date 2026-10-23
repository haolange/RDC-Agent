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
  it('coalesces repeated cancellation and timeout into one initial kill and one escalation', async () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    vi.useFakeTimers();
    try {
      const supervisor = new ProcessSupervisor();
      const supervised = supervisor.spawn('other', 'fake-command', [], { isolateProcessGroup: false, timeoutMs: 10 });
      supervised.abort('abort');
      supervised.abort('timeout');
      const joined = supervised.join(10);
      expect(childState.spawnSync).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      expect(childState.spawnSync).toHaveBeenCalledTimes(2);
      supervised.abort('supervisor_kill');
      await vi.advanceTimersByTimeAsync(1100);
      expect(childState.spawnSync).toHaveBeenCalledTimes(2);
      await expect(joined).resolves.toMatchObject({ reason: 'unconfirmed_orphan' });
      expect(supervisor.size).toBe(1);
      childState.child.emit('close', 1, null);
      await expect(supervised.exit).resolves.toMatchObject({ reason: 'abort' });
      expect(supervisor.size).toBe(0);
    } finally {
      childState.child.emit('close', 1, null);
      vi.useRealTimers();
      Object.defineProperty(process, 'platform', platform);
    }
  });

  it('bounds the Windows tree-killer itself and never treats its return as observed child exit', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    try {
      childState.spawnSync.mockReturnValueOnce({ error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) });
      const supervisor = new ProcessSupervisor();
      const supervised = supervisor.spawn('other', 'fake-command', [], { isolateProcessGroup: false });
      supervised.abort();
      const options = childState.spawnSync.mock.calls.at(-1)?.[2] as { timeout?: number } | undefined;
      expect(options?.timeout).toBeGreaterThan(0);
      expect(options?.timeout).toBeLessThanOrEqual(5000);
      expect(supervisor.size).toBe(1);
      childState.child.emit('close', 1, null);
      expect(supervisor.size).toBe(0);
    } finally {
      Object.defineProperty(process, 'platform', platform);
    }
  });

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
