import { create } from 'zustand';
import { useProjectStore } from './projectStore';
import type { SessionRecord, SessionRecordSnapshot, SessionRevision } from '@shared/types/session';

/** Session fields the person changes from the renderer; shown at once while main has not confirmed the write. */
export type SessionIntent = Partial<Pick<SessionRecord, 'agentId' | 'modelOverride' | 'turnControls'>>;
type IntentField = keyof SessionIntent;
type PendingFields = Partial<Record<IntentField, { intentId: number; value: SessionIntent[IntentField] }>>;

interface SessionRecordState {
  /** The newest record main reported for each session, by revision. */
  records: Record<string, SessionRecordSnapshot>;
  /** In-flight intents per session and field; a later intent for a field replaces the earlier one. */
  pending: Record<string, PendingFields>;
  /** Record with the pending overlay; recomputed only when either changes, so selectors keep their identity. */
  views: Record<string, SessionRecord>;
  /** Keeps each snapshot only when its revision is newer than the one held; returns whether any was kept. */
  accept: (snapshots: SessionRecordSnapshot | readonly SessionRecordSnapshot[]) => boolean;
  beginIntent: (sessionId: string, intent: SessionIntent) => number;
  /** Ends an intent when main answered, accepted or not; a field a later intent replaced is left alone. */
  settleIntent: (sessionId: string, intentId: number) => void;
  reset: () => void;
}

/** A different epoch is a restarted main process and always supersedes; within one epoch the larger write count does. */
export function isNewerSessionRevision(next: SessionRevision, current: SessionRevision | undefined): boolean {
  return !current || next.epoch !== current.epoch || next.n > current.n;
}

function composeView(snapshot: SessionRecordSnapshot | undefined, pending: PendingFields | undefined): SessionRecord | undefined {
  if (!snapshot) return undefined;
  const fields = pending ? Object.entries(pending) : [];
  if (fields.length === 0) return snapshot.record;
  return { ...snapshot.record, ...Object.fromEntries(fields.map(([field, entry]) => [field, entry.value])) };
}

function withView(state: Pick<SessionRecordState, 'records' | 'pending' | 'views'>, sessionId: string) {
  const view = composeView(state.records[sessionId], state.pending[sessionId]);
  const views = { ...state.views };
  if (view) views[sessionId] = view;
  else delete views[sessionId];
  return views;
}

let intentCounter = 0;

export const useSessionRecordStore = create<SessionRecordState>((set) => ({
  records: {},
  pending: {},
  views: {},
  accept: (input) => {
    const snapshots: readonly SessionRecordSnapshot[] = 'record' in input ? [input] : input;
    let kept = false;
    set((state) => {
      const records = { ...state.records };
      let views = state.views;
      for (const snapshot of snapshots) {
        const sessionId = snapshot.record.sessionId;
        if (!isNewerSessionRevision(snapshot.revision, records[sessionId]?.revision)) continue;
        records[sessionId] = snapshot;
        kept = true;
        views = withView({ records, pending: state.pending, views }, sessionId);
      }
      return kept ? { records, views } : state;
    });
    return kept;
  },
  beginIntent: (sessionId, intent) => {
    const intentId = ++intentCounter;
    set((state) => {
      const fields: PendingFields = { ...state.pending[sessionId] };
      for (const [field, value] of Object.entries(intent) as Array<[IntentField, SessionIntent[IntentField]]>) {
        fields[field] = { intentId, value };
      }
      const pending = { ...state.pending, [sessionId]: fields };
      return { pending, views: withView({ ...state, pending }, sessionId) };
    });
    return intentId;
  },
  settleIntent: (sessionId, intentId) => set((state) => {
    const current = state.pending[sessionId];
    if (!current || !Object.values(current).some((entry) => entry.intentId === intentId)) return state;
    const fields = Object.fromEntries(Object.entries(current).filter(([, entry]) => entry.intentId !== intentId)) as PendingFields;
    const pending = { ...state.pending };
    if (Object.keys(fields).length > 0) pending[sessionId] = fields;
    else delete pending[sessionId];
    return { pending, views: withView({ ...state, pending }, sessionId) };
  }),
  reset: () => set({ records: {}, pending: {}, views: {} }),
}));

export function acceptSessionSnapshot(snapshots: SessionRecordSnapshot | readonly SessionRecordSnapshot[]): void {
  useSessionRecordStore.getState().accept(snapshots);
}

/** Accepts every listed record and returns the list rows the sidebar shows. */
export function receiveSessionList(snapshots: readonly SessionRecordSnapshot[]): SessionRecord[] {
  acceptSessionSnapshot(snapshots);
  return snapshots.map((snapshot) => snapshot.record);
}

export function getSessionView(sessionId: string | null | undefined): SessionRecord | null {
  return sessionId ? useSessionRecordStore.getState().views[sessionId] ?? null : null;
}

export function getCurrentSessionView(): SessionRecord | null {
  return getSessionView(useProjectStore.getState().currentSessionId);
}

/** The session as main last wrote it, with the person's in-flight intents on top. */
export function useSessionView(sessionId: string | null | undefined): SessionRecord | null {
  return useSessionRecordStore((state) => (sessionId ? state.views[sessionId] ?? null : null));
}

export function useCurrentSessionView(): SessionRecord | null {
  return useSessionView(useProjectStore((state) => state.currentSessionId));
}
