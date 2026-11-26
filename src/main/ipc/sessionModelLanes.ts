import type { SessionModelWriteRequest, SessionRecord } from '@shared/types/session';

type SessionModelField = 'modelOverride' | 'turnControls';
export type SessionModelFields = Partial<Pick<SessionRecord, SessionModelField>>;

const FIELDS: readonly SessionModelField[] = ['modelOverride', 'turnControls'];

/**
 * Main's ordering of the session model lanes. Each field `session:setModelOverride` writes (the model override, the
 * turn controls) keeps the newest client revision written for a session; an intent that arrives, or finishes checking
 * its model, after a newer one was written leaves that field alone. The renderer therefore sends every choice at once
 * instead of queueing it behind the previous one. Memory only: revisions come from the renderer's clock and only grow.
 */
export class SessionModelLanes {
  private readonly written = new Map<string, Partial<Record<SessionModelField, number>>>();

  /** The fields of `request` that are newer than what their lane last wrote for the session. */
  newer(sessionId: string, request: SessionModelWriteRequest): SessionModelFields {
    const written = this.written.get(sessionId) ?? {};
    const fields: SessionModelFields = {};
    if (request.modelOverride !== undefined && request.clientRevision > (written.modelOverride ?? 0)) {
      fields.modelOverride = request.modelOverride;
    }
    if (request.turnControls !== undefined && request.clientRevision > (written.turnControls ?? 0)) {
      fields.turnControls = request.turnControls;
    }
    return fields;
  }

  /** Records that `fields` were written at the request's revision. */
  wrote(sessionId: string, clientRevision: number, fields: SessionModelFields): void {
    const written = { ...this.written.get(sessionId) };
    for (const field of FIELDS) if (field in fields) written[field] = clientRevision;
    this.written.set(sessionId, written);
  }

  forget(sessionId: string): void {
    this.written.delete(sessionId);
  }
}
