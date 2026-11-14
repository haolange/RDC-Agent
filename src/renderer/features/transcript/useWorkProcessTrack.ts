import { useLayoutEffect, type RefObject } from 'react';
import { assignDynStyle, clearDynStyle } from '../../lib/useDynStyle';

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

/** Measure the labelled entrances on this rail, never the height of a card or its descendants. */
export function useWorkProcessTrack(ref: RefObject<HTMLDivElement | null>, firstId?: string) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let logicalStart: number | undefined;
    let connected = true;
    const measured = new Set<HTMLElement>();
    const measure = () => {
      if (!connected) return;
      const bounds = root.getBoundingClientRect();
      const centers: number[] = [];
      const positioned = new Set<HTMLElement>();
      for (const anchor of root.querySelectorAll<HTMLElement>('[data-work-anchor]')) {
        if (anchor.closest('[data-work-track]') !== root || !anchor.getClientRects().length) continue;
        const parent = anchor.parentElement!;
        const target = [...parent.querySelectorAll<HTMLElement>(nodeTarget)]
          .find(element => element.closest('[data-work-track]') === root && element.getClientRects().length > 0);
        if (!target) continue;
        const center = firstLineCenter(target, target.getBoundingClientRect());
        const y = center - bounds.top;
        assignDynStyle(anchor, { top: `${center - parent.getBoundingClientRect().top}px`, visibility: 'visible' });
        positioned.add(anchor);
        centers.push(y);
        if (anchor.dataset.workAnchor === firstId) logicalStart = y;
      }
      for (const old of measured) if (!positioned.has(old)) { clearDynStyle(old); measured.delete(old); }
      positioned.forEach(anchor => measured.add(anchor));
      // Keep the measured logical start when windowing removes its DOM row.
      const start = logicalStart ?? centers[0] ?? 0;
      const end = centers.at(-1) ?? start;
      assignDynStyle(root, { '--work-track-start': `${start}px`, '--work-track-length': `${Math.max(0, end - start)}px` });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    const mutations = new MutationObserver(measure);
    mutations.observe(root, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['open', 'class', 'data-work-node', 'data-work-node-prose'] });
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
