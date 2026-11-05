import { useEffect, useRef, useState } from 'react';
import { getElectronApi } from '../../../platform/getElectronApi';
import type { ProviderProbeBatch } from '@shared/types/providerProbe';

export function useProviderProbeBatch(providerIds?: string[]) {
  const [batch, setBatch] = useState<ProviderProbeBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const owned = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const api = getElectronApi();
    const accept = (next: ProviderProbeBatch | null) => {
      if (mounted.current) setBatch(previous => previous && next && previous.revision > next.revision ? previous : next);
    };
    const unsubscribe = api?.events.onProbeBatchChanged(accept);
    void api?.llm.getProbeBatch().then(accept).catch(() => {});
    return () => {
      mounted.current = false;
      unsubscribe?.();
      if (owned.current) void api?.llm.cancelProbeBatch(owned.current).catch(() => {});
    };
  }, []);
  const action = async (kind: 'prepare' | 'start' | 'cancel' | 'retry') => {
    const api = getElectronApi();
    if (!api) return;
    setBusy(true);
    setError('');
    try {
      const next = kind === 'prepare' || kind === 'retry'
        ? await api.llm.prepareProbeBatch({ providerIds, ...(kind === 'retry' && batch ? { retryRunId: batch.id } : {}) })
        : kind === 'start' && batch ? await api.llm.startProbeBatch(batch.id)
        : batch ? await api.llm.cancelProbeBatch(batch.id) : null;
      if (kind === 'prepare' || kind === 'retry') owned.current = next?.id ?? null;
      if (!mounted.current) {
        if (next && owned.current === next.id) await api.llm.cancelProbeBatch(next.id);
        return;
      }
      setBatch(previous => previous && next && previous.revision > next.revision ? previous : next);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const inScope = !providerIds || batch?.items.every(item => providerIds.includes(item.providerId));
  return { batch: inScope ? batch : null, busy, error, action,
    occupied: batch?.state === 'running' || batch?.state === 'cancelling' };
}
