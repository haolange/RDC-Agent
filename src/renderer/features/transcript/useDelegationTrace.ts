import React from 'react';
import type { DelegationTraceHeader, DelegationTracePage, DelegationTraceStep } from '@shared/types/delegationTrace';
import { useElectronApi } from '../../hooks/useElectronApi';

const empty: DelegationTracePage = { header: null, steps: [], nextCursor: null, total: 0, revision: 0 };
const PAGE_SIZE = 40;

function sameIdentity(a: DelegationTraceHeader | null, b: DelegationTraceHeader | null): boolean {
  return !!a && !!b && a.childSessionId === b.childSessionId
    && a.executionId === b.executionId && a.generation === b.generation;
}

function mergeSteps(previous: DelegationTraceStep[], incoming: DelegationTraceStep[], prepend: boolean): DelegationTraceStep[] {
  const byId = new Map(previous.map((step) => [step.id, step]));
  for (const step of incoming) byId.set(step.id, step);
  const ids = [...new Set(prepend
    ? [...incoming.map((step) => step.id), ...previous.map((step) => step.id)]
    : [...previous.map((step) => step.id), ...incoming.map((step) => step.id)])];
  return ids.map((id) => byId.get(id)!);
}

export function useDelegationTrace(sessionId: string | null | undefined, parentToolCallId: string, historyOpen: boolean) {
  const api = useElectronApi();
  const [page, setPage] = React.useState<DelegationTracePage>(empty);
  const [headerLoading, setHeaderLoading] = React.useState(Boolean(sessionId));
  const [loading, setLoading] = React.useState(false);
  const [revision, setRevision] = React.useState(0);
  const [earliest, setEarliest] = React.useState<number | null>(null);
  const state = React.useRef({ page, earliest });
  state.current = { page, earliest };
  const loadedIdentity = React.useRef('');

  React.useEffect(() => {
    setPage(empty);
    setHeaderLoading(Boolean(sessionId));
    setEarliest(null);
    setRevision(0);
  }, [sessionId, parentToolCallId]);

  React.useEffect(() => {
    if (!sessionId || !api) return;
    const unsubscribe = api.events.onDelegationTraceChanged((event) => {
      if (event.sessionId === sessionId && event.parentToolCallId === parentToolCallId) {
        setRevision((current) => Math.max(current, event.revision));
      }
    });
    return unsubscribe;
  }, [api, sessionId, parentToolCallId]);

  React.useEffect(() => {
    if (!sessionId || !api) return;
    let cancelled = false;
    const identity = `${sessionId}\u0000${parentToolCallId}`;
    if (loadedIdentity.current !== identity || !state.current.page.header) setHeaderLoading(true);
    loadedIdentity.current = identity;
    setLoading(historyOpen);
    void (async () => {
      const head = await api.conversation.getDelegationTrace({ sessionId, parentToolCallId, cursor: 0, pageSize: 0 });
      if (cancelled) return;
      setHeaderLoading(false);
      const previous = state.current.page;
      const identityChanged = previous.header && head.header && !sameIdentity(previous.header, head.header);
      if (identityChanged) setEarliest(null);
      setPage((current) => ({ ...head, steps: identityChanged ? [] : current.steps }));
      if (!historyOpen || !head.header) { setLoading(false); return; }
      const loaded = state.current.earliest !== null && !identityChanged;
      const start = loaded ? 0 : Math.max(0, head.total - PAGE_SIZE);
      const next = await api.conversation.getDelegationTrace({ sessionId, parentToolCallId,
        cursor: start, pageSize: loaded ? 120 : PAGE_SIZE,
        ...(loaded ? { sinceRevision: previous.revision } : {}) });
      if (cancelled || !sameIdentity(head.header, next.header)) return;
      if (loaded) {
        const updates = [...next.steps];
        let cursor = next.nextCursor;
        while (cursor !== null && !cancelled) {
          const remaining = await api.conversation.getDelegationTrace({ sessionId, parentToolCallId,
            cursor, pageSize: 120, sinceRevision: previous.revision });
          updates.push(...remaining.steps);
          cursor = remaining.nextCursor;
        }
        if (!cancelled) setPage((current) => ({ ...next, steps: mergeSteps(current.steps, updates, false) }));
      } else {
        setPage(next);
        setEarliest(start);
      }
      if (!cancelled) setLoading(false);
    })().catch(() => { if (!cancelled) {
      setHeaderLoading(false);
      setLoading(false);
      setPage((current) => ({ ...current, error: 'DELEGATION_TRACE_READ_FAILED' }));
    } });
    return () => { cancelled = true; };
  }, [api, sessionId, parentToolCallId, historyOpen, revision]);

  const loadEarlier = React.useCallback(async () => {
    if (!api || !sessionId || earliest === null || earliest <= 0 || loading) return;
    setLoading(true);
    try {
      const start = Math.max(0, earliest - PAGE_SIZE);
      const earlier = await api.conversation.getDelegationTrace({ sessionId, parentToolCallId,
        cursor: start, pageSize: earliest - start });
      if (!sameIdentity(state.current.page.header, earlier.header)) return;
      setPage((current) => ({ ...current, steps: mergeSteps(current.steps, earlier.steps, true) }));
      setEarliest(start);
    } catch { setPage((current) => ({ ...current, error: 'DELEGATION_TRACE_READ_FAILED' })); }
    finally { setLoading(false); }
  }, [api, sessionId, parentToolCallId, earliest, loading]);

  return { page, loading, headerLoading, hasEarlier: earliest !== null && earliest > 0, loadEarlier,
    retry: () => setRevision((current) => current + 1) };
}
