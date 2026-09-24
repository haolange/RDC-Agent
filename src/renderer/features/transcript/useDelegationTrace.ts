import React from 'react';
import type { DelegationTracePage } from '@shared/types/delegationTrace';
import { useElectronApi } from '../../hooks/useElectronApi';

const empty: DelegationTracePage = { header: null, steps: [], nextCursor: null, total: 0 };

export function useDelegationTrace(sessionId: string | null | undefined, parentToolCallId: string, expanded: boolean) {
  const api = useElectronApi();
  const [page, setPage] = React.useState<DelegationTracePage>(empty);
  const [visibleCount, setVisibleCount] = React.useState(40);
  const [revision, setRevision] = React.useState(0);

  React.useEffect(() => {
    if (!sessionId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = api?.events.onDelegationTraceChanged(({ sessionId: changedSession, parentToolCallId: changedCall }) => {
      if (changedSession !== sessionId || changedCall !== parentToolCallId || timer) return;
      timer = setTimeout(() => { timer = undefined; setRevision((value) => value + 1); }, 100);
    });
    return () => { unsubscribe?.(); if (timer) clearTimeout(timer); };
  }, [api, sessionId, parentToolCallId]);

  React.useEffect(() => {
    if (!sessionId || !api?.conversation.getDelegationTrace) return;
    let active = true;
    const load = async () => {
      const targetCount = expanded ? visibleCount : 0;
      const first = await api.conversation.getDelegationTrace({ sessionId, parentToolCallId, cursor: 0, pageSize: Math.min(targetCount, 80) });
      if (!expanded || !first.nextCursor || first.steps.length >= targetCount) {
        if (active) setPage(first);
        return;
      }
      const steps = [...first.steps];
      let cursor: number | null = first.nextCursor;
      while (cursor !== null && steps.length < targetCount && active) {
        const next = await api.conversation.getDelegationTrace({ sessionId, parentToolCallId, cursor, pageSize: Math.min(80, targetCount - steps.length) });
        steps.push(...next.steps);
        cursor = next.nextCursor;
      }
      if (active) setPage({ ...first, steps, nextCursor: cursor });
    };
    void load().catch(() => { if (active) setPage({ ...empty, error: 'DELEGATION_TRACE_READ_FAILED' }); });
    return () => { active = false; };
  }, [api, sessionId, parentToolCallId, expanded, visibleCount, revision]);

  React.useEffect(() => { setVisibleCount(40); setPage(empty); }, [sessionId, parentToolCallId]);
  return { page, showMore: () => setVisibleCount((count) => count + 40) };
}
