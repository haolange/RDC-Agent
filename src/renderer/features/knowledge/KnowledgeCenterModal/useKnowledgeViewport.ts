import { useEffect, useState } from 'react';
import type { KnowledgeNarrowPane } from './knowledgeCenterModel';

/** Knowledge's existing split-pane breakpoint, shared by its pane navigation. */
export function useKnowledgeViewport() {
  const [narrow, setNarrow] = useState(false);
  const [narrowPane, setNarrowPane] = useState<KnowledgeNarrowPane>('spaces');
  useEffect(() => {
    const media = window.matchMedia('(max-width: 960px)');
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  return { narrow, narrowPane, setNarrowPane };
}
