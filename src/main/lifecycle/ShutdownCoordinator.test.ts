import { describe, expect, it, vi } from 'vitest';
import { ShutdownCoordinator, SHUTDOWN_PHASE_ORDER } from './ShutdownCoordinator';

describe('ShutdownCoordinator', () => {
  it('releases owned runtimes before joining supervised processes', () => {
    expect(SHUTDOWN_PHASE_ORDER.indexOf('release_owned_runtimes')).toBeLessThan(
      SHUTDOWN_PHASE_ORDER.indexOf('terminate_processes'),
    );
  });

  it('runs disposables through the shutdown state machine once', async () => {
    const coordinator = new ShutdownCoordinator();
    const phases: string[] = [];

    coordinator.register({
      id: 'stop',
      phase: 'stop_accepting_turns',
      dispose: () => {
        phases.push('stop_accepting_turns');
      },
    });
    coordinator.register({
      id: 'abort',
      phase: 'abort_all',
      dispose: async () => {
        phases.push('abort_all');
      },
    });
    coordinator.register({
      id: 'join',
      phase: 'join_producers',
      dispose: async () => {
        phases.push('join_producers');
      },
    });
    coordinator.register({
      id: 'release',
      phase: 'release_owned_runtimes',
      dispose: async () => {
        phases.push('release_owned_runtimes');
      },
    });
    coordinator.register({
      id: 'terminate',
      phase: 'terminate_processes',
      dispose: () => {
        phases.push('terminate_processes');
      },
    });
    coordinator.register({
      id: 'flush',
      phase: 'flush_storage',
      dispose: () => {
        phases.push('flush_storage');
      },
    });

    expect(coordinator.getPhase()).toBe('running');
    const first = coordinator.shutdownAll(1_000, { cause: 'window-close' });
    const second = coordinator.shutdownAll(1_000, { cause: 'SIGTERM' });
    await Promise.all([first, second]);

    expect(phases).toEqual([
      'stop_accepting_turns',
      'abort_all',
      'join_producers',
      'release_owned_runtimes',
      'terminate_processes',
      'flush_storage',
    ]);
    expect(coordinator.getPhase()).toBe('exited');
  });

  it('tells the observer its cause, the phase that ran out of time with what was pending, and a forced end', async () => {
    vi.useFakeTimers();
    try {
      const coordinator = new ShutdownCoordinator();
      const events: unknown[] = [];
      const forceExit = vi.fn(() => events.push('force-exit'));
      coordinator.register({ id: 'fast', phase: 'join_producers', dispose: () => undefined });
      coordinator.register({ id: 'slow', phase: 'join_producers', dispose: () => new Promise<void>(() => {}) });

      void coordinator.shutdownAll(50, {
        cause: 'SIGINT',
        forceExit,
        observer: {
          began: (cause) => events.push(['began', cause]),
          phaseTimedOut: (phase, pending) => events.push(['timed-out', phase, pending]),
          finished: ({ timedOut }) => events.push(['finished', timedOut]),
        },
      });
      await vi.advanceTimersByTimeAsync(60);

      expect(events).toEqual([
        ['began', 'SIGINT'],
        ['timed-out', 'join_producers', ['slow']],
        ['finished', true],
        'force-exit',
      ]);
      expect(forceExit).toHaveBeenCalledOnce();
      expect(coordinator.getPhase()).toBe('exited');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a shutdown that finished in time as not timed out', async () => {
    const coordinator = new ShutdownCoordinator();
    const finished = vi.fn();
    coordinator.register({ id: 'flush', phase: 'flush_storage', dispose: () => undefined });
    await coordinator.shutdownAll(1_000, {
      cause: 'before-quit',
      observer: { began: () => undefined, phaseTimedOut: () => undefined, finished },
    });
    expect(finished).toHaveBeenCalledWith({ timedOut: false, durationMs: expect.any(Number) });
  });
});
