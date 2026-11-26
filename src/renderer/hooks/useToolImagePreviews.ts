import { useEffect, useRef, useState } from 'react';
import { RevisionLanes } from '../lib/revisionLanes';
import { getToolImagePreview } from './conversationPreview';
import type { ConversationToolImagePreviewRef } from '@shared/types/conversation';

let active = 0;
const queue: Array<() => void> = [];
function schedule(read: () => Promise<void>) {
  const start = () => {
    active += 1;
    void read().finally(() => {
      active -= 1;
      queue.shift()?.();
    });
  };
  if (active < 4) start();
  else queue.push(start);
}
export type ImagePreviewState = { url?: string; failed?: boolean };

/** Bounded across mounted galleries. Navigation invalidates queued and late reads. */
export function useToolImagePreviews(sessionId: string | undefined, previews: ConversationToolImagePreviewRef[]) {
  const [attempt, setAttempt] = useState(0);
  const retryId = useRef<string | null>(null);
  const [state, setState] = useState<{ scope?: string; values: Record<string, ImagePreviewState> }>({ values: {} });
  const ids = previews.map((preview) => preview.previewId).join('\0');
  // Each session and preview set is one read revision; queued and late reads of a superseded one change nothing.
  const [lanes] = useState(() => new RevisionLanes());
  useEffect(() => {
    const revision = lanes.begin('previews');
    const current = () => lanes.isLatest('previews', revision);
    const only = retryId.current;
    retryId.current = null;
    setState((previous) => ({ scope: sessionId, values: previous.scope === sessionId ? previous.values : {} }));
    if (!sessionId) return;
    for (const id of ids.split('\0').filter(Boolean)) {
      if (only && id !== only) continue;
      schedule(async () => {
        if (!current()) return;
        let value: ImagePreviewState;
        try {
          const result = await getToolImagePreview({ sessionId, previewId: id });
          value = result?.dataUrl ? { url: result.dataUrl } : { failed: true };
        } catch {
          value = { failed: true };
        }
        if (current()) setState((previous) => ({ scope: sessionId, values: { ...previous.values, [id]: value } }));
      });
    }
    return () => {
      lanes.forget('previews');
    };
  }, [lanes, sessionId, ids, attempt]);
  return {
    values: state.scope === sessionId ? state.values : {},
    retry: (id: string) => {
      retryId.current = id;
      setAttempt((value) => value + 1);
    },
  };
}
