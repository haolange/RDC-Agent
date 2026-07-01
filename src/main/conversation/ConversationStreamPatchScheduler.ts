import type {
  ConversationMessage,
  ConversationStreamEvent,
} from '@shared/types/conversation';

type TimerHandle = ReturnType<typeof setTimeout>;

export interface ConversationStreamPatchCommitOptions {
  persist: boolean;
  publishTrace: boolean;
}

export interface ConversationStreamPatchCommit {
  type: ConversationStreamEvent['type'];
  patch: Partial<ConversationMessage>;
  options: ConversationStreamPatchCommitOptions;
}

interface ConversationStreamPatchSchedulerOptions {
  commit: (commit: ConversationStreamPatchCommit) => void;
  textFlushMs?: number;
  traceFlushMs?: number;
  persistFlushMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimer?: (timer: TimerHandle) => void;
}

interface FlushPendingOptions {
  forcePersist?: boolean;
  publishTrace?: boolean;
}

const DEFAULT_TEXT_FLUSH_MS = 80;
const DEFAULT_TRACE_FLUSH_MS = 160;
const DEFAULT_PERSIST_FLUSH_MS = 600;

export class ConversationStreamPatchScheduler {
  private readonly commit: (commit: ConversationStreamPatchCommit) => void;
  private readonly textFlushMs: number;
  private readonly traceFlushMs: number;
  private readonly persistFlushMs: number;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, delayMs: number) => TimerHandle;
  private readonly clearTimer: (timer: TimerHandle) => void;

  private pendingTextPatch: Partial<ConversationMessage> | null = null;
  private pendingTracePatch: Partial<ConversationMessage> | null = null;
  private textTimer: TimerHandle | null = null;
  private traceTimer: TimerHandle | null = null;
  private lastPersistedAt = 0;
  private closed = false;

  constructor(options: ConversationStreamPatchSchedulerOptions) {
    this.commit = options.commit;
    this.textFlushMs = options.textFlushMs ?? DEFAULT_TEXT_FLUSH_MS;
    this.traceFlushMs = options.traceFlushMs ?? DEFAULT_TRACE_FLUSH_MS;
    this.persistFlushMs = options.persistFlushMs ?? DEFAULT_PERSIST_FLUSH_MS;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  }

  queueText(patch: Partial<ConversationMessage>): void {
    if (this.closed) return;
    this.pendingTextPatch = {
      ...this.pendingTextPatch,
      ...patch,
    };
    if (!this.textTimer) {
      this.textTimer = this.setTimer(() => this.flushText(false), this.textFlushMs);
    }
  }

  queueTrace(patch: Partial<ConversationMessage>): void {
    if (this.closed) return;
    this.pendingTracePatch = {
      ...this.pendingTracePatch,
      ...patch,
    };
    if (!this.traceTimer) {
      this.traceTimer = this.setTimer(() => this.flushTrace(false, true), this.traceFlushMs);
    }
  }

  commitImmediate(
    type: ConversationStreamEvent['type'],
    patch: Partial<ConversationMessage>,
    options: Partial<ConversationStreamPatchCommitOptions> = {},
  ): void {
    if (this.closed) return;
    this.flushPending({ forcePersist: false, publishTrace: options.publishTrace ?? true });
    const persist = options.persist ?? true;
    this.commit({
      type,
      patch,
      options: {
        persist,
        publishTrace: options.publishTrace ?? true,
      },
    });
    if (persist) {
      this.lastPersistedAt = this.now();
    }
  }

  commitTerminal(
    type: ConversationStreamEvent['type'],
    patch: Partial<ConversationMessage>,
  ): void {
    if (this.closed) return;
    this.flushPending({ forcePersist: true, publishTrace: true });
    this.commit({
      type,
      patch,
      options: {
        persist: true,
        publishTrace: true,
      },
    });
    this.lastPersistedAt = this.now();
    this.close();
  }

  flushPending(options: FlushPendingOptions = {}): void {
    if (this.closed) return;
    this.flushText(Boolean(options.forcePersist));
    this.flushTrace(Boolean(options.forcePersist), options.publishTrace ?? true);
  }

  close(): void {
    if (this.textTimer) {
      this.clearTimer(this.textTimer);
      this.textTimer = null;
    }
    if (this.traceTimer) {
      this.clearTimer(this.traceTimer);
      this.traceTimer = null;
    }
    this.pendingTextPatch = null;
    this.pendingTracePatch = null;
    this.closed = true;
  }

  private flushText(forcePersist: boolean): void {
    if (this.textTimer) {
      this.clearTimer(this.textTimer);
      this.textTimer = null;
    }
    if (!this.pendingTextPatch) {
      return;
    }
    const patch = this.pendingTextPatch;
    this.pendingTextPatch = null;
    const persist = forcePersist || this.shouldPersist();
    this.commit({
      type: 'message_patched',
      patch,
      options: {
        persist,
        publishTrace: false,
      },
    });
    if (persist) {
      this.lastPersistedAt = this.now();
    }
  }

  private flushTrace(forcePersist: boolean, publishTrace: boolean): void {
    if (this.traceTimer) {
      this.clearTimer(this.traceTimer);
      this.traceTimer = null;
    }
    if (!this.pendingTracePatch) {
      return;
    }
    const patch = this.pendingTracePatch;
    this.pendingTracePatch = null;
    const persist = forcePersist || this.shouldPersist();
    this.commit({
      type: 'message_patched',
      patch,
      options: {
        persist,
        publishTrace,
      },
    });
    if (persist) {
      this.lastPersistedAt = this.now();
    }
  }

  private shouldPersist(): boolean {
    return this.now() - this.lastPersistedAt >= this.persistFlushMs;
  }
}
