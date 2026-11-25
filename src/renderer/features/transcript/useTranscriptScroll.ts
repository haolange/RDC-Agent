import { useCallback, useLayoutEffect, useRef, type MutableRefObject } from 'react';

const STICKY_SCROLL_THRESHOLD = 96;

interface LaidOut { scrollHeight: number; clientHeight: number }

/** Reads the container's heights and keeps them as the geometry the reader last saw. */
const readLayout = (container: HTMLDivElement, laidOut: MutableRefObject<LaidOut>): number => {
  laidOut.current = { scrollHeight: container.scrollHeight, clientHeight: container.clientHeight };
  return laidOut.current.scrollHeight;
};

/**
 * Follow new content only while the reader remains near the bottom.
 *
 * A scroll event reads no layout. While streaming, one arrives after every follow, and reading the geometry there
 * forced a layout of the whole transcript each time. The event only marks the position as unsettled; the next follow
 * decision (a commit or a resize) settles it first, measured against the content height the reader saw: the height
 * from the last layout read, so content added since then does not count as the reader leaving the bottom.
 */
export function useTranscriptScroll(messageCount: number, activityAt: number | undefined) {
  const isEmpty = messageCount === 0;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottom = useRef(true);
  const scrolledSinceSettled = useRef(false);
  const laidOut = useRef<LaidOut>({ scrollHeight: 0, clientHeight: 0 });
  const settleScroll = useCallback((container: HTMLDivElement) => {
    if (!scrolledSinceSettled.current) return;
    scrolledSinceSettled.current = false;
    shouldStickToBottom.current = laidOut.current.scrollHeight - container.scrollTop
      - laidOut.current.clientHeight < STICKY_SCROLL_THRESHOLD;
  }, []);
  const followContent = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    settleScroll(container);
    if (shouldStickToBottom.current) {
      container.scrollTo({ top: readLayout(container, laidOut), behavior: 'auto' });
    }
  }, [settleScroll]);
  /** Resize observations arrive after layout, so their reads are free; they keep the laid-out height current. */
  const followResize = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    settleScroll(container);
    const scrollHeight = readLayout(container, laidOut);
    if (shouldStickToBottom.current) container.scrollTo({ top: scrollHeight, behavior: 'auto' });
  }, [settleScroll]);
  const handleScroll = useCallback(() => {
    scrolledSinceSettled.current = true;
  }, []);

  useLayoutEffect(followContent, [followContent, messageCount, activityAt]);
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(followResize);
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
  }, [followResize, isEmpty]);

  return { scrollContainerRef, handleScroll };
}
