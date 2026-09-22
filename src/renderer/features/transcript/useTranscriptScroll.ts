import { useCallback, useLayoutEffect, useRef } from 'react';

const STICKY_SCROLL_THRESHOLD = 96;

/** Follow new content only while the reader remains near the bottom. */
export function useTranscriptScroll(messageCount: number, activityAt: number | undefined) {
  const isEmpty = messageCount === 0;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottom = useRef(true);
  const followContent = useCallback(() => {
    const container = scrollContainerRef.current;
    if (container && shouldStickToBottom.current) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
    }
  }, []);
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    shouldStickToBottom.current = container.scrollHeight - container.scrollTop
      - container.clientHeight < STICKY_SCROLL_THRESHOLD;
  }, []);

  useLayoutEffect(followContent, [followContent, messageCount, activityAt]);
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(followContent);
    const observed = new Set<Element>();
    const refreshTargets = () => {
      const targets = new Set<Element>([container]);
      if (container.firstElementChild) targets.add(container.firstElementChild);
      // A virtual list has a fixed estimated height. Its rendered rows can grow
      // independently when an image loads or a tool disclosure opens.
      container.querySelectorAll('.conversation-thread-item').forEach((row) => targets.add(row));
      for (const target of observed) {
        if (!targets.has(target)) { observer.unobserve(target); observed.delete(target); }
      }
      for (const target of targets) {
        if (!observed.has(target)) { observer.observe(target); observed.add(target); }
      }
    };
    refreshTargets();
    const mutations = new MutationObserver(refreshTargets);
    mutations.observe(container, { childList: true, subtree: true });
    return () => { mutations.disconnect(); observer.disconnect(); observed.clear(); };
  }, [followContent, isEmpty]);

  return { scrollContainerRef, handleScroll };
}
