import { useEffect, useState } from 'react';
import { isSafeKnowledgePreviewPath, normalizeKnowledgePreviewPath } from './knowledgeCardImages';

export type KnowledgeCardImageState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; dataUrl: string }
  | { status: 'missing' };

export function useKnowledgeCardImage(spaceId: string | undefined, relativePath: string | undefined): KnowledgeCardImageState {
  const [state, setState] = useState<KnowledgeCardImageState>({ status: 'idle' });
  const safePath = relativePath && isSafeKnowledgePreviewPath(relativePath)
    ? normalizeKnowledgePreviewPath(relativePath)
    : '';

  useEffect(() => {
    if (!spaceId || !safePath) {
      setState({ status: relativePath ? 'missing' : 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    void window.electronAPI.knowledge.image({ spaceId, relativePath: safePath }).then((result) => {
      if (cancelled) return;
      if (result.dataUrl) {
        setState({ status: 'ready', dataUrl: result.dataUrl });
        return;
      }
      setState({ status: 'missing' });
    }).catch(() => {
      if (cancelled) return;
      setState({ status: 'missing' });
    });
    return () => {
      cancelled = true;
    };
  }, [relativePath, safePath, spaceId]);

  return state;
}
