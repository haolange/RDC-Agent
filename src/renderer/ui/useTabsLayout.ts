import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useDynStyle } from '../lib/useDynStyle';

interface Indicator {
  x: number;
  width: number;
}

/**
 * Measures the selected tab so one indicator can slide between options, and — when `collapsible` — drops
 * to icon-only once the labelled row no longer fits its container, restoring labels when the container
 * regains the width the labelled row needed.
 */
export function useTabsLayout(
  rootRef: RefObject<HTMLDivElement | null>,
  listRef: RefObject<HTMLDivElement | null>,
  selectedIndex: number,
  collapsible: boolean,
) {
  const [indicator, setIndicator] = useState<Indicator | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const labelledWidth = useRef(0);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const list = listRef.current;
    if (!root || !list || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const measure = () => {
      if (collapsible) {
        if (!collapsed && list.scrollWidth > root.clientWidth + 1) {
          labelledWidth.current = list.scrollWidth;
          setCollapsed(true);
          return;
        }
        if (collapsed && root.clientWidth >= labelledWidth.current) {
          setCollapsed(false);
          return;
        }
      }
      const tab = list.querySelectorAll<HTMLElement>('[role="tab"]')[selectedIndex];
      const next = tab ? { x: tab.offsetLeft, width: tab.offsetWidth } : null;
      setIndicator((current) => (current?.x === next?.x && current?.width === next?.width ? current : next));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    observer.observe(list);
    list.querySelectorAll('[role="tab"]').forEach((tab) => observer.observe(tab));
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [rootRef, listRef, selectedIndex, collapsible, collapsed]);

  const indicatorStyle = useDynStyle(
    indicator
      ? {
          '--ui-tabs-indicator-x': `${indicator.x}px`,
          '--ui-tabs-indicator-width': `${indicator.width}px`,
        }
      : {},
  );
  return { collapsed, measured: indicator !== null, indicatorStyle };
}
