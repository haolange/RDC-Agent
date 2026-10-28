import { useLayoutEffect, type RefObject } from 'react';
import { assignDynStyle, clearDynStyle } from '../../lib/useDynStyle';

/** One guide spans logical list height, including the windowing spacers. */
export function useWorkProcessTrack(ref: RefObject<HTMLDivElement | null>, firstId?: string) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let start = 0;
    let connected = true;
    const measured = new Set<HTMLElement>();
    const measure = () => {
      if (!connected) return;
      const bounds = root.getBoundingClientRect();
      const anchors = [...root.querySelectorAll<HTMLElement>('[data-work-anchor]')]
        .filter(anchor => anchor.closest('[data-work-track]') === root
          && !anchor.closest('details:not([open])') && anchor.getClientRects().length > 0);
      for (const old of measured) if (!anchors.includes(old)) { clearDynStyle(old); measured.delete(old); }
      for (const anchor of anchors) {
        const parent = anchor.parentElement!;
        const target = parent.querySelector<HTMLElement>(':scope > .work-process-step-content > .work-card-trigger, :scope > .work-card-trigger, :scope > .work-process-step-content > * > .work-card-trigger, :scope > .work-process-step-content > .work-process-thinking-state, :scope > .work-process-step-content > .work-process-prose, :scope > .work-process-step-content > details > summary')
          ?? parent.querySelector<HTMLElement>('.work-process-summary-line, .work-process-step-summary, .work-process-diagnostic-message')
          ?? parent;
        const targetBox = target.getBoundingClientRect();
        const isText = target.matches('.work-process-thinking-state, .work-process-prose, .work-process-step-summary, .work-process-diagnostic-message');
        const line = Number.parseFloat(getComputedStyle(target).lineHeight) || targetBox.height;
        const center = targetBox.top + (isText ? Math.min(targetBox.height, line) : targetBox.height) / 2;
        assignDynStyle(anchor, { top: `${center - parent.getBoundingClientRect().top}px` });
        measured.add(anchor);
        if (anchor.dataset.workAnchor === firstId) start = center - bounds.top;
      }
      const leading = root.querySelector<HTMLElement>(':scope > .work-process-track-leading');
      if (leading) start = leading.getBoundingClientRect().top - bounds.top
        + (leading.firstElementChild?.getBoundingClientRect().height ?? 0) / 2;
      // A virtual spacer represents real offscreen events, never a new first/last event.
      const virtual = [...root.querySelectorAll('[data-virtualized="true"]')]
        .some(list => list.closest('[data-work-track]') === root);
      const hasLine = anchors.length + (leading ? 1 : 0) > 1 || Boolean(virtual);
      assignDynStyle(root, { '--work-track-start': `${start}px`, '--work-track-display': hasLine ? 'block' : 'none' });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    const mutations = new MutationObserver(measure);
    mutations.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'class', 'data-work-node'] });
    const fonts = document.fonts;
    fonts?.addEventListener?.('loadingdone', measure);
    void fonts?.ready?.then(measure);
    measure();
    return () => {
      connected = false;
      observer.disconnect(); mutations.disconnect();
      fonts?.removeEventListener?.('loadingdone', measure);
      measured.forEach(clearDynStyle); clearDynStyle(root);
    };
  }, [ref, firstId]);
}
