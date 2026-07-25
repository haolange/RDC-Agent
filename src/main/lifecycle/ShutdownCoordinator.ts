/**
 * ShutdownCoordinator — unified disposable registration and timed shutdown state machine.
 */

export type ShutdownPhase =
  | 'running'
  | 'stop_accepting_turns'
  | 'abort_all'
  | 'join_producers'
  | 'terminate_processes'
  | 'flush_storage'
  | 'exited';

export type ShutdownDisposablePhase =
  | 'stop_accepting_turns'
  | 'abort_all'
  | 'join_producers'
  | 'terminate_processes'
  | 'flush_storage';

export interface ShutdownDisposable {
  id: string;
  phase: ShutdownDisposablePhase;
  dispose: () => void | Promise<void>;
}

const PHASE_ORDER: ShutdownDisposablePhase[] = [
  'stop_accepting_turns',
  'abort_all',
  'join_producers',
  'terminate_processes',
  'flush_storage',
];

export class ShutdownCoordinator {
  private phase: ShutdownPhase = 'running';
  private readonly disposables = new Map<string, ShutdownDisposable>();
  private shutdownPromise: Promise<void> | null = null;

  getPhase(): ShutdownPhase {
    return this.phase;
  }

  isShuttingDown(): boolean {
    return this.phase !== 'running';
  }

  register(disposable: ShutdownDisposable): () => void {
    this.disposables.set(disposable.id, disposable);
    return () => {
      this.disposables.delete(disposable.id);
    };
  }

  async shutdownAll(timeoutMs: number, forceExit?: () => void): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.runShutdown(timeoutMs, forceExit);
    return this.shutdownPromise;
  }

  private async runShutdown(timeoutMs: number, forceExit?: () => void): Promise<void> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    let forceExitTimer: ReturnType<typeof setTimeout> | null = null;

    if (forceExit) {
      forceExitTimer = setTimeout(() => {
        this.phase = 'exited';
        forceExit();
      }, Math.max(0, timeoutMs));
      forceExitTimer.unref?.();
    }

    try {
      for (const phase of PHASE_ORDER) {
        this.phase = phase;
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await this.runPhase(phase, remaining);
      }
      this.phase = 'exited';
    } finally {
      if (forceExitTimer) clearTimeout(forceExitTimer);
    }
  }

  private async runPhase(phase: ShutdownDisposablePhase, timeoutMs: number): Promise<void> {
    const tasks = Array.from(this.disposables.values())
      .filter((entry) => entry.phase === phase)
      .map(async (entry) => {
        try {
          await entry.dispose();
        } catch (error) {
          console.error(`[ShutdownCoordinator] disposable ${entry.id} failed during ${phase}:`, error);
        }
      });

    if (tasks.length === 0) return;

    await Promise.race([
      Promise.allSettled(tasks),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        timer.unref?.();
      }),
    ]);
  }
}

export const shutdownCoordinator = new ShutdownCoordinator();
