/**
 * ShutdownCoordinator — unified disposable registration and timed shutdown state machine.
 */

import type { ShutdownCause } from '@shared/types/lifecycle';

export type ShutdownPhase =
  | 'running'
  | 'stop_accepting_turns'
  | 'abort_all'
  | 'join_producers'
  | 'release_owned_runtimes'
  | 'terminate_processes'
  | 'flush_storage'
  | 'exited';

export type ShutdownDisposablePhase =
  | 'stop_accepting_turns'
  | 'abort_all'
  | 'join_producers'
  | 'release_owned_runtimes'
  | 'terminate_processes'
  | 'flush_storage';

export interface ShutdownDisposable {
  id: string;
  phase: ShutdownDisposablePhase;
  dispose: () => void | Promise<void>;
}

export const SHUTDOWN_PHASE_ORDER: ShutdownDisposablePhase[] = [
  'stop_accepting_turns',
  'abort_all',
  'join_producers',
  'release_owned_runtimes',
  'terminate_processes',
  'flush_storage',
];

/**
 * What the composition root learns about a shutdown as it runs: its cause, each phase that did not finish in time with
 * the disposables still pending, and how it ended. The lifecycle ledger is bound here; this layer cannot import it.
 */
export interface ShutdownObserver {
  began(cause: ShutdownCause): void;
  phaseTimedOut(phase: ShutdownDisposablePhase, pending: string[]): void;
  finished(outcome: { timedOut: boolean; durationMs: number }): void;
}

export interface ShutdownOptions {
  cause: ShutdownCause;
  observer?: ShutdownObserver;
  /** Called once the deadline passes with phases still running; the clean and the forced path end the same way. */
  forceExit?: () => void;
}

const NO_OBSERVER: ShutdownObserver = { began: () => {}, phaseTimedOut: () => {}, finished: () => {} };

export class ShutdownCoordinator {
  private phase: ShutdownPhase = 'running';
  private readonly disposables = new Map<string, ShutdownDisposable>();
  /** Disposables of the running phase that have not settled yet. */
  private readonly pending = new Set<string>();
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

  async shutdownAll(timeoutMs: number, options: ShutdownOptions): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.runShutdown(timeoutMs, options);
    return this.shutdownPromise;
  }

  private async runShutdown(timeoutMs: number, options: ShutdownOptions): Promise<void> {
    const observer = options.observer ?? NO_OBSERVER;
    const startedAt = Date.now();
    const deadline = startedAt + Math.max(0, timeoutMs);
    const timedOutPhases = new Set<ShutdownDisposablePhase>();
    let ended = false;
    const timedOut = (phase: ShutdownDisposablePhase, pending: string[]) => {
      if (ended || timedOutPhases.has(phase)) return;
      timedOutPhases.add(phase);
      observer.phaseTimedOut(phase, pending);
    };
    // Read after an await: the forced end may have run meanwhile.
    const hasEnded = () => ended;
    const end = () => {
      if (ended) return;
      ended = true;
      this.phase = 'exited';
      observer.finished({ timedOut: timedOutPhases.size > 0, durationMs: Date.now() - startedAt });
    };
    let forceExitTimer: ReturnType<typeof setTimeout> | null = null;

    observer.began(options.cause);
    if (options.forceExit) {
      const forceExit = options.forceExit;
      forceExitTimer = setTimeout(
        () => {
          if (this.phase !== 'running' && this.phase !== 'exited') timedOut(this.phase, [...this.pending]);
          end();
          forceExit();
        },
        Math.max(0, timeoutMs),
      );
      forceExitTimer.unref();
    }

    try {
      for (const phase of SHUTDOWN_PHASE_ORDER) {
        if (hasEnded()) break;
        this.phase = phase;
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          timedOut(phase, this.idsOf(phase));
          break;
        }
        const pending = await this.runPhase(phase, remaining);
        if (pending.length > 0) timedOut(phase, pending);
      }
      end();
    } finally {
      if (forceExitTimer) clearTimeout(forceExitTimer);
    }
  }

  private idsOf(phase: ShutdownDisposablePhase): string[] {
    return Array.from(this.disposables.values())
      .filter((entry) => entry.phase === phase)
      .map((entry) => entry.id);
  }

  /** Runs one phase until its disposables settle or its time is up; returns the ones still pending. */
  private async runPhase(phase: ShutdownDisposablePhase, timeoutMs: number): Promise<string[]> {
    this.pending.clear();
    const tasks = Array.from(this.disposables.values())
      .filter((entry) => entry.phase === phase)
      .map(async (entry) => {
        this.pending.add(entry.id);
        try {
          await entry.dispose();
        } catch (error) {
          console.error(`[ShutdownCoordinator] disposable ${entry.id} failed during ${phase}:`, error);
        } finally {
          this.pending.delete(entry.id);
        }
      });

    if (tasks.length === 0) return [];

    await Promise.race([
      Promise.allSettled(tasks),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        timer.unref();
      }),
    ]);
    return [...this.pending];
  }
}

export const shutdownCoordinator = new ShutdownCoordinator();
