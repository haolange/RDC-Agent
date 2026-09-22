import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';
import { assignDynStyle, clearDynStyle } from '../../lib/useDynStyle';
import { COMPOSER_PROMPT_MAX_HEIGHT, COMPOSER_PROMPT_MIN_HEIGHT } from './composerPromptGeometry';

/** Measure after CodeMirror's update cycle; both panes use their rendered padding. */
export function useComposerMarkdownSizing(hostRef: RefObject<HTMLDivElement>, value: string, mode: 'write' | 'preview') {
  const request = useRef<() => void>(() => {});
  const schedule = useCallback(() => request.current(), []);
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let frame = 0;
    let disposed = false;
    const measure = () => {
      if (disposed || !host.getClientRects().length) return;
      const stage = host.querySelector<HTMLElement>('.composer-markdown-stage');
      const content = host.querySelector<HTMLElement>(mode === 'write' ? '.cm-content' : '.composer-markdown-preview');
      if (!stage || !content) return;
      const css = getComputedStyle(stage);
      const padding = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom);
      assignDynStyle(host, { height: COMPOSER_PROMPT_MIN_HEIGHT + 'px' });
      const height = Math.min(COMPOSER_PROMPT_MAX_HEIGHT, Math.max(COMPOSER_PROMPT_MIN_HEIGHT, content.scrollHeight + padding));
      assignDynStyle(host, { height: height + 'px' });
    };
    const enqueue = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    request.current = enqueue;
    let width = -1;
    const resize = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target !== host || entry.contentRect.width !== width) enqueue();
        if (entry.target === host) width = entry.contentRect.width;
      }
    });
    resize.observe(host);
    const content = host.querySelector(mode === 'write' ? '.cm-content' : '.composer-markdown-preview > *');
    if (content) resize.observe(content);
    const mutation = new MutationObserver(enqueue);
    for (let node: HTMLElement | null = host; node; node = node.parentElement) {
      mutation.observe(node, { attributes: true, attributeFilter: ['class', 'hidden', 'data-font-scale'] });
    }
    document.fonts?.addEventListener('loadingdone', enqueue);
    void document.fonts?.ready.then(() => { if (!disposed) enqueue(); });
    enqueue();
    return () => {
      disposed = true;
      request.current = () => {};
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      document.fonts?.removeEventListener('loadingdone', enqueue);
      clearDynStyle(host);
    };
  }, [hostRef, mode]);
  useLayoutEffect(schedule, [value, schedule]);
  return schedule;
}
