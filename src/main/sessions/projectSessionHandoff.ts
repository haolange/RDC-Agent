import type { SessionRecord } from '@shared/types/session';
import { isActiveHandoffLifecycle, type ProfileHandoffState } from '@shared/types/profileHandoff';
import { storageAdapter } from './StorageAdapter';

export function projectSessionAgentId(
  session: Pick<SessionRecord, 'agentId'>,
  active: ProfileHandoffState | null | undefined,
): string | undefined {
  if (active && isActiveHandoffLifecycle(active.lifecycle)) {
    return active.toAgentId;
  }
  return session.agentId;
}

export function projectSessionForClient(session: SessionRecord): SessionRecord {
  const agentId = projectSessionAgentId(session, storageAdapter.handoffs.getActive(session.sessionId));
  const handoffNotice = storageAdapter.handoffs.readDocument(session.sessionId)?.migrationNotice;
  if (agentId === session.agentId && !handoffNotice) return session;
  return { ...session, agentId, ...(handoffNotice ? { handoffNotice } : {}) };
}
