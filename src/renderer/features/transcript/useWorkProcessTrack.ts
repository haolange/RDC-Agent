import { useLayoutEffect, type RefObject } from 'react';
import { assignDynStyles, clearDynStyles } from '../../lib/useDynStyle';

const nodeTarget = '[data-work-node-heading], [data-work-node-prose]';

function firstLineCenter(target: HTMLElement, box: DOMRect): number {
  if (!target.hasAttribute('data-work-node-prose')) return box.top + box.height / 2;
  const line = Number.parseFloat(getComputedStyle(target).lineHeight) || box.height;
  const firstBlock = target.querySelector('.markdown-body')?.firstElementChild;
  if (firstBlock) {
    const firstBox = firstBlock.getBoundingClientRect();
    const firstLine = Number.parseFloat(getComputedStyle(firstBlock).lineHeight) || firstBox.height;
    return firstBox.top + Math.min(firstLine, firstBox.height) / 2;
  }
  return box.top + Math.min(line, box.height) / 2;
}

/**
 * Measure the labelled entrances on this rail, never the height of a card or its descendants. Every
 * layout read happens before any style write, and observer bursts (streaming text, font loads) collapse
 * into one measurement per frame.
 */
export function useWorkProcessTrack(ref: RefObject<HTMLDivElement | null>, firstId?: string) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let logicalStart: number | undefined;
    let connected = true;
    let frame = 0;
    const measured = new Set<HTMLElement>();
    const measure = () => {
      frame = 0;
      if (!connected) return;
      const bounds = root.getBoundingClientRect();
      const placements: Array<readonly [HTMLElement, { top: string; visibility: string }]> = [];
      const centers: number[] = [];
      for (const anchor of root.querySelectorAll<HTMLElement>('[data-work-anchor]')) {
        if (anchor.closest('[data-work-track]') !== root || !anchor.getClientRects().length) continue;
        const parent = anchor.parentElement!;
        const target = [...parent.querySelectorAll<HTMLElement>(nodeTarget)]
          .find(element => element.closest('[data-work-track]') === root && element.getClientRects().length > 0);
        if (!target) continue;
        const center = firstLineCenter(target, target.getBoundingClientRect());
        const y = center - bounds.top;
        placements.push([anchor, { top: `${center - parent.getBoundingClientRect().top}px`, visibility: 'visible' }]);
        centers.push(y);
        if (anchor.dataset.workAnchor === firstId) logicalStart = y;
      }
      const positioned = new Set(placements.map(([anchor]) => anchor));
      const stale = [...measured].filter((anchor) => !positioned.has(anchor));
      stale.forEach((anchor) => measured.delete(anchor));
      positioned.forEach((anchor) => measured.add(anchor));
      // Keep the measured logical start when windowing removes its DOM row.
      const start = logicalStart ?? centers[0] ?? 0;
      const end = centers.at(-1) ?? start;
      clearDynStyles(stale);
      assignDynStyles([
        ...placements,
        [root, { '--work-track-start': `${start}px`, '--work-track-length': `${Math.max(0, end - start)}px` }],
      ]);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    const mutations = new MutationObserver(schedule);
    mutations.observe(root, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['open', 'class', 'data-work-node', 'data-work-node-prose'] });
    const fonts = document.fonts;
    fonts?.addEventListener?.('loadingdone', schedule);
    void fonts?.ready?.then(schedule);
    measure();
    return () => {
      connected = false;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect(); mutations.disconnect();
      fonts?.removeEventListener?.('loadingdone', schedule);
      clearDynStyles([...measured, root]);
    };
  }, [ref, firstId]);
}
