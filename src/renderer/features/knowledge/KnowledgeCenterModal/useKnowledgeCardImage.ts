import { useAsyncValue } from '../../../lib/useAsyncValue';
import { isSafeKnowledgePreviewPath, normalizeKnowledgePreviewPath } from './knowledgeCardImages';

export type KnowledgeCardImageState =
  { status: 'idle' } | { status: 'loading' } | { status: 'ready'; dataUrl: string } | { status: 'missing' };

export function useKnowledgeCardImage(
  spaceId: string | undefined,
  relativePath: string | undefined,
): KnowledgeCardImageState {
  const safePath =
    relativePath && isSafeKnowledgePreviewPath(relativePath) ? normalizeKnowledgePreviewPath(relativePath) : '';
  const image = useAsyncValue(
    spaceId && safePath ? JSON.stringify([spaceId, safePath]) : null,
    async () =>
      (await window.electronAPI.knowledge.image({ spaceId: spaceId!, relativePath: safePath })).dataUrl ?? null,
  );
  if (image.status === 'idle') return { status: relativePath ? 'missing' : 'idle' };
  if (image.status === 'loading') return image;
  return image.status === 'ready' && image.value ? { status: 'ready', dataUrl: image.value } : { status: 'missing' };
}
