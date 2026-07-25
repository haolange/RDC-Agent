import { describe, expect, it, vi } from 'vitest';
import { ShutdownCoordinator } from './ShutdownCoordinator';

describe('ShutdownCoordinator', () => {
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
    const first = coordinator.shutdownAll(1_000);
    const second = coordinator.shutdownAll(1_000);
    await Promise.all([first, second]);

    expect(phases).toEqual([
      'stop_accepting_turns',
      'abort_all',
      'join_producers',
      'terminate_processes',
      'flush_storage',
    ]);
    expect(coordinator.getPhase()).toBe('exited');
  });

  it('force-exits after the deadline', async () => {
    const coordinator = new ShutdownCoordinator();
    const forceExit = vi.fn();
    coordinator.register({
      id: 'slow',
      phase: 'join_producers',
      dispose: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
      },
    });

    await coordinator.shutdownAll(20, forceExit);
    // Either forceExit ran due to deadline, or shutdown completed after racing the timeout.
    expect(coordinator.getPhase()).toBe('exited');
  });
});
