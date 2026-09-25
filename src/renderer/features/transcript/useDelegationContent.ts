import React from 'react';
import type { DelegationContentKind } from '@shared/types/delegationTrace';
import { useElectronApi } from '../../hooks/useElectronApi';

export function useDelegationContent(input: {
  sessionId?: string | null;
  parentToolCallId: string;
  childSessionId?: string;
  executionId?: string;
  generation?: number;
  kind: DelegationContentKind;
  open: boolean;
  available: boolean;
  stepId?: string;
}) {
  const api = useElectronApi();
  const [text, setText] = React.useState('');
  const [offset, setOffset] = React.useState<number | null>(0);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(false);
  const generation = React.useRef(0);
  React.useEffect(() => { generation.current += 1; setText(''); setOffset(0); setError(false); setLoading(false); },
    [input.sessionId, input.parentToolCallId, input.childSessionId, input.executionId,
      input.generation, input.kind, input.stepId]);
  const load = React.useCallback(async () => {
    if (!api || !input.sessionId || !input.childSessionId || !input.available || offset === null || loading) return;
    const expectedGeneration = generation.current;
    setLoading(true);
    try {
      const page = await api.conversation.getDelegationContent({ sessionId: input.sessionId,
        parentToolCallId: input.parentToolCallId, childSessionId: input.childSessionId,
        executionId: input.executionId, generation: input.generation,
        kind: input.kind, stepId: input.stepId, offset });
      if (generation.current !== expectedGeneration) return;
      setText((current) => current + page.text);
      setOffset(page.nextOffset);
      setError(false);
    } catch { if (generation.current === expectedGeneration) setError(true); }
    finally { if (generation.current === expectedGeneration) setLoading(false); }
  }, [api, input.sessionId, input.parentToolCallId, input.childSessionId, input.executionId,
    input.generation, input.kind, input.stepId, input.available, offset, loading]);
  React.useEffect(() => { if (input.open && input.available && offset === 0 && !loading && !error) void load(); },
    [input.open, input.available, offset, loading, error, load]);
  return { text, hasMore: offset !== null && offset > 0, loading, error,
    loadMore: load, retry: () => { setError(false); } };
}
