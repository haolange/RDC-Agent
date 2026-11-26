import { randomUUID } from 'node:crypto';
import { reportProcessFault } from '../../runtime/processFaultHandlers';
import type { SessionRecord, SessionRecordSnapshot, SessionRevision } from '@shared/types/session';

/**
 * In-memory write order of session records. `SessionRecordStore` reports every session.json write here; each write
 * takes the next `n` of this process run's `epoch` and is broadcast as `session:recordChanged`. Responses that carry a
 * session attach the revision of its last write, so the renderer keeps the newest record whatever order replies and
 * events arrive in. Nothing here is persisted: a restarted main process starts a new epoch.
 */
export class SessionRevisionRegistry {
  private readonly epoch = randomUUID();
  private n = 0;
  private readonly latest = new Map<string, number>();
  private readonly listeners = new Set<(snapshot: SessionRecordSnapshot) => void>();

  /** Records one session.json write and broadcasts the record with its new revision. */
  written(record: SessionRecord): SessionRecordSnapshot {
    this.n += 1;
    this.latest.set(record.sessionId, this.n);
    const snapshot = { record, revision: { epoch: this.epoch, n: this.n } };
    for (const listener of this.listeners) {
      // A subscriber cannot undo a durable write; a failing one is reported.
      try {
        listener(snapshot);
      } catch (error) {
        reportProcessFault('Session record listener failed', error);
      }
    }
    return snapshot;
  }

  /** The revision of the session's last write in this process run; `n: 0` when it has not been written since start. */
  revisionOf(sessionId: string): SessionRevision {
    return { epoch: this.epoch, n: this.latest.get(sessionId) ?? 0 };
  }

  /** Pairs a record read or written just now, with no await in between, with its revision. */
  snapshot(record: SessionRecord): SessionRecordSnapshot {
    return { record, revision: this.revisionOf(record.sessionId) };
  }

  forget(sessionId: string): void {
    this.latest.delete(sessionId);
  }

  subscribe(listener: (snapshot: SessionRecordSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const sessionRevisions = new SessionRevisionRegistry();
