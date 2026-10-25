import { useEffect, useRef, useState } from 'react';
import type { ConversationToolImagePreviewRef } from '@shared/types/conversation';
import { getToolImagePreview } from './conversationPreview';

let active = 0;
const queue: Array<() => void> = [];
function schedule(read: () => Promise<void>) {
  const start = () => {
    active += 1;
    void read().finally(() => { active -= 1; queue.shift()?.(); });
  };
  if (active < 4) start(); else queue.push(start);
}
export type ImagePreviewState = { url?: string; failed?: boolean };

/** Bounded across mounted galleries. Navigation invalidates queued and late reads. */
export function useToolImagePreviews(sessionId: string | undefined, previews: ConversationToolImagePreviewRef[]) {
  const [attempt, setAttempt] = useState(0);
  const retryId = useRef<string | null>(null);
  const [state, setState] = useState<{ scope?: string; values: Record<string, ImagePreviewState> }>({ values: {} });
  const ids = previews.map(preview => preview.previewId).join('\0');
  useEffect(() => {
    let cancelled = false;
    const only = retryId.current;
    retryId.current = null;
    setState(previous => ({ scope: sessionId, values: previous.scope === sessionId ? previous.values : {} }));
    if (!sessionId) return;
    for (const id of ids.split('\0').filter(Boolean)) {
      if (only && id !== only) continue;
      schedule(async () => {
        if (cancelled) return;
        let value: ImagePreviewState;
        try {
          const result = await getToolImagePreview({ sessionId, previewId: id });
          value = result?.dataUrl ? { url: result.dataUrl } : { failed: true };
        } catch { value = { failed: true }; }
        if (!cancelled) setState(previous => ({ scope: sessionId, values: { ...previous.values, [id]: value } }));
      });
    }
    return () => { cancelled = true; };
  }, [sessionId, ids, attempt]);
  return { values: state.scope === sessionId ? state.values : {}, retry: (id: string) => {
    retryId.current = id;
    setAttempt(value => value + 1);
  } };
}
