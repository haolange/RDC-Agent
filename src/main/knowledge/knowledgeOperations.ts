import { AppError } from '@shared/errors/appError';
import type { KnowledgeOperationPhase, KnowledgeOperationProgress } from '@shared/types/knowledgeOperation';

/** `done` of `total` items finished in `phase`. */
export type KnowledgeProgressReport = (phase: KnowledgeOperationPhase, done: number, total: number) => void;

/**
 * What a long knowledge task receives from its caller. The task checks `signal` between items, never inside a write,
 * and reports progress as it goes; both are optional so the same service call also runs unobserved.
 */
export interface KnowledgeOperationOptions {
  signal?: AbortSignal;
  onProgress?: KnowledgeProgressReport;
}

/** At most this many progress events per second per operation; the last report is always delivered. */
export const KNOWLEDGE_PROGRESS_EVENTS_PER_SECOND = 10;

/**
 * Coalesces progress reports into at most one event per interval: a report inside the interval waits for its end,
 * and a newer report replaces the waiting one. `flush` delivers the waiting report at once and closes the stream.
 */
export function createKnowledgeProgressThrottle(
  operationId: string,
  emit: (progress: KnowledgeOperationProgress) => void,
  intervalMs = 1000 / KNOWLEDGE_PROGRESS_EVENTS_PER_SECOND,
): { report: KnowledgeProgressReport; flush: () => void } {
  let pending: KnowledgeOperationProgress | null = null;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  const send = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!pending) return;
    const next = pending;
    pending = null;
    lastSentAt = Date.now();
    emit(next);
  };
  return {
    report: (phase, done, total) => {
      if (closed) return;
      pending = { operationId, phase, done, total };
      const wait = lastSentAt + intervalMs - Date.now();
      if (wait <= 0) send();
      else timer ??= setTimeout(send, wait);
    },
    flush: () => {
      closed = true;
      send();
    },
  };
}

interface RunningOperation {
  controller: AbortController;
  settled: Promise<unknown>;
}

/**
 * The running knowledge operations by renderer-chosen id. `run` gives each one an AbortSignal whose reason is the
 * registered cancellation code, so a task that stops on it rejects with `KNOWLEDGE_OPERATION_CANCELLED`; `cancel`
 * aborts one by id and `abortAll` stops every one and waits for them to settle (shutdown).
 */
export class KnowledgeOperationRegistry {
  private readonly running = new Map<string, RunningOperation>();

  constructor(
    private readonly emit: (progress: KnowledgeOperationProgress) => void,
    private readonly intervalMs?: number,
  ) {}

  async run<T>(operationId: string, work: (options: Required<KnowledgeOperationOptions>) => Promise<T>): Promise<T> {
    if (this.running.has(operationId)) {
      throw new AppError('IPC_VALIDATION_ERROR', `knowledge operation ${operationId} is already running.`);
    }
    const controller = new AbortController();
    const progress = createKnowledgeProgressThrottle(operationId, this.emit, this.intervalMs);
    const entry: RunningOperation = { controller, settled: Promise.resolve() };
    this.running.set(operationId, entry);
    const settled = (async () => {
      try {
        return await work({ signal: controller.signal, onProgress: progress.report });
      } finally {
        progress.flush();
        this.running.delete(operationId);
      }
    })();
    entry.settled = settled;
    return settled;
  }

  cancel(operationId: string): boolean {
    const entry = this.running.get(operationId);
    if (!entry || entry.controller.signal.aborted) return false;
    entry.controller.abort(new AppError('KNOWLEDGE_OPERATION_CANCELLED'));
    return true;
  }

  async abortAll(): Promise<void> {
    const entries = [...this.running.values()];
    for (const entry of entries) {
      if (!entry.controller.signal.aborted) entry.controller.abort(new AppError('KNOWLEDGE_OPERATION_CANCELLED'));
    }
    await Promise.allSettled(entries.map((entry) => entry.settled));
  }
}
