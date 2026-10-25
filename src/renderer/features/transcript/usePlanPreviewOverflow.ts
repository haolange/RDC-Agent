import { useLayoutEffect, useRef, useState } from 'react';
import { assignDynStyle, clearDynStyle } from '../../lib/useDynStyle';

/** Observe the rendered excerpt, including reflow after fonts or Markdown change. */
export function usePlanPreviewOverflow(content: string) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const preview = previewRef.current;
    if (!preview) return undefined;
    let active = true;
    const measure = () => {
      if (!active) return;
      const clipped = preview.scrollHeight > preview.clientHeight + 1;
      setOverflowing(clipped);
      if (!clipped) { clearDynStyle(preview); return; }
      const bounds = preview.getBoundingClientRect();
      const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let lastTextBottom = 0;
      let textLineHeight = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        range.selectNodeContents(node);
        for (const rect of Array.from(range.getClientRects?.() ?? [])) {
          if (rect.width > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom - .5) {
            lastTextBottom = Math.max(lastTextBottom, Math.min(rect.bottom, bounds.bottom) - bounds.top);
            textLineHeight = rect.height;
          }
        }
      }
      range.detach();
      const lineHeight = Number.parseFloat(getComputedStyle(preview).lineHeight) || textLineHeight;
      const end = lastTextBottom || bounds.height;
      assignDynStyle(preview, { '--plan-fade-start': `${Math.max(0, end - .75 * lineHeight)}px`, '--plan-fade-end': `${end}px` });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(preview);
    if (preview.firstElementChild) observer.observe(preview.firstElementChild);
    const fonts = document.fonts;
    fonts?.addEventListener?.('loadingdone', measure);
    void fonts?.ready?.then(measure);
    window.addEventListener('resize', measure);
    return () => {
      active = false;
      observer.disconnect();
      clearDynStyle(preview);
      fonts?.removeEventListener?.('loadingdone', measure);
      window.removeEventListener('resize', measure);
    };
  }, [content]);
  return { previewRef, overflowing };
}
