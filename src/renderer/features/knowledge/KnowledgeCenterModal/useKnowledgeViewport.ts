import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KnowledgeNarrowPane } from './knowledgeCenterModel';

/** Knowledge's existing split-pane breakpoint, shared by its pane navigation. */
export function useKnowledgeViewport() {
  const [narrow, setNarrow] = useState(false);
  const [narrowPane, setNarrowPane] = useState<KnowledgeNarrowPane>('spaces');
  const backButtonRef = useRef<HTMLButtonElement>(null);
  const listFocusRef = useRef<HTMLDivElement>(null);
  const focusPane = useRef<'list' | 'detail' | null>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 960px)');
    const sync = () => setNarrow(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  // Moving from a row or Back replaces the source pane. Tabs keep their own focus.
  const navigateToPane = useCallback(
    (pane: 'list' | 'detail') => {
      if (!narrow || narrowPane === pane) return;
      focusPane.current = pane;
      setNarrowPane(pane);
    },
    [narrow, narrowPane],
  );

  useLayoutEffect(() => {
    if (focusPane.current !== narrowPane) return;
    focusPane.current = null;
    if (narrowPane === 'detail') {
      backButtonRef.current?.focus();
    } else {
      const list = listFocusRef.current;
      (list?.querySelector<HTMLElement>('[aria-selected="true"]') ?? list)?.focus();
    }
  }, [narrowPane]);

  return { narrow, narrowPane, setNarrowPane, navigateToPane, backButtonRef, listFocusRef };
}
