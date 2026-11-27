import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface WindowRange {
  start: number;
  end: number;
}

export interface WindowedListOptions {
  /** Row keys in order; a row keeps its measured height under its key while rows are added around it. */
  keys: readonly string[];
  /** Whether rows outside the viewport are left unmounted. */
  enabled: boolean;
  /** Height assumed for a row that has not been measured yet. */
  estimate: number;
  /** Rows mounted beyond each edge of the viewport. */
  overscan: number;
  /** Rows mounted before the first measurement of the viewport. */
  initialCount: number;
  /** The element that scrolls the list; looked up after every render, so a list can change scrollers. */
  scrollerOf: (list: HTMLElement) => HTMLElement | null;
  /** Spacer elements the list renders around its window; they are not rows. */
  spacerClassName: string;
  /** A row that ends above the viewport moves the scroller by its height change, so the view stays put. */
  anchorAbove?: boolean;
}

export interface WindowedList<T extends HTMLElement> {
  listRef: RefObject<T>;
  range: WindowRange;
  /** The top of each row, then the end of the last one. */
  offsets: number[];
  /** The top of a row as of the latest render. */
  rowOffset: (index: number) => number;
  updateRange: () => void;
}

/** Rows are keyed, so a row keeps its measured height and DOM while rows arrive before or after it. */
export function windowOffsets(
  keys: readonly string[],
  heights: ReadonlyMap<string, number>,
  estimate: number,
): number[] {
  const offsets = [0];
  for (const key of keys) offsets.push(offsets[offsets.length - 1] + (heights.get(key) ?? estimate));
  return offsets;
}

function indexAtOffset(offsets: number[], value: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (offsets[middle] <= value) low = middle;
    else high = middle - 1;
  }
  return Math.min(low, offsets.length - 2);
}

/** The list's top inside its scroller's content, and the viewport's top relative to the list. */
function viewportOf(list: HTMLElement, scroller: HTMLElement): { listTop: number; viewStart: number } {
  const listTop = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  return { listTop, viewStart: scroller.scrollTop - listTop };
}

/**
 * Scroll windowing with measured row heights, shared by the transcript and Working's row lists: only the rows near
 * the viewport mount, spacers stand in for the rest, and one ResizeObserver measures the mounted rows.
 */
export function useWindowedList<T extends HTMLElement>(options: WindowedListOptions): WindowedList<T> {
  const { keys, enabled, estimate, overscan, initialCount, scrollerOf, spacerClassName, anchorAbove = false } = options;
  const count = keys.length;
  const listRef = useRef<T>(null);
  const heights = useRef(new Map<string, number>());
  const [revision, setRevision] = useState(0);
  const [range, setRange] = useState<WindowRange>({ start: 0, end: Math.min(count, initialCount) });
  const offsets = windowOffsets(keys, heights.current, estimate);
  // Callbacks read the latest render through a ref, so they stay the same while rows stream in.
  const latest = useRef({ keys, offsets, range, scrollerOf, estimate });
  latest.current = { keys, offsets, range, scrollerOf, estimate };

  const updateRange = useCallback(() => {
    const list = listRef.current;
    if (!list || !enabled) return;
    const scroller = latest.current.scrollerOf(list);
    if (!scroller) {
      setRange((current) => (current.start === 0 && current.end === count ? current : { start: 0, end: count }));
      return;
    }
    const { viewStart: top } = viewportOf(list, scroller);
    const viewStart = Math.max(0, top);
    const viewEnd = viewStart + scroller.clientHeight;
    const start = Math.max(0, indexAtOffset(latest.current.offsets, viewStart) - overscan);
    const end = Math.min(count, indexAtOffset(latest.current.offsets, viewEnd) + overscan + 1);
    setRange((current) => (current.start === start && current.end === end ? current : { start, end }));
  }, [count, enabled, overscan]);
  const rowOffset = useCallback((index: number) => latest.current.offsets[index] ?? 0, []);

  // The scroller can change without the row count changing (Working switching between following and showing
  // everything); after every render the listeners move to whichever element actually scrolls.
  const updateRangeRef = useRef(updateRange);
  updateRangeRef.current = updateRange;
  const binding = useRef<{ scroller: HTMLElement; release: () => void } | null>(null);
  useLayoutEffect(() => {
    const scroller = listRef.current ? latest.current.scrollerOf(listRef.current) : null;
    if (binding.current?.scroller === scroller) return;
    binding.current?.release();
    binding.current = null;
    if (!scroller) return;
    const onChange = () => updateRangeRef.current();
    scroller.addEventListener('scroll', onChange, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onChange);
    observer?.observe(scroller);
    binding.current = {
      scroller,
      release: () => {
        scroller.removeEventListener('scroll', onChange);
        observer?.disconnect();
      },
    };
    onChange();
  });
  // Before paint: a row appended at the bottom (a message just sent) mounts in the same frame it is added.
  useLayoutEffect(updateRange, [count, revision, updateRange]);

  // One observer measures the mounted rows; after every render it follows rows mounting and unmounting.
  const measuring = useRef<{ observer: ResizeObserver; rows: Map<Element, number> } | null>(null);
  const anchorAboveRef = useRef(anchorAbove);
  anchorAboveRef.current = anchorAbove;
  useEffect(() => {
    const list = listRef.current;
    if (!enabled || !list || typeof ResizeObserver === 'undefined') {
      measuring.current?.observer.disconnect();
      measuring.current = null;
      return;
    }
    if (!measuring.current) {
      const state: { observer: ResizeObserver; rows: Map<Element, number> } = {
        rows: new Map(),
        observer: new ResizeObserver((entries) => {
          const host = listRef.current;
          const scroller = host ? latest.current.scrollerOf(host) : null;
          const viewStart = anchorAboveRef.current && host && scroller ? viewportOf(host, scroller).viewStart : null;
          let changed = false;
          let anchorDelta = 0;
          for (const entry of entries) {
            const index = state.rows.get(entry.target);
            const key = index === undefined ? undefined : latest.current.keys[index];
            if (index === undefined || key === undefined) continue;
            const height = entry.borderBoxSize[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
            if (!Number.isFinite(height) || height <= 0) continue;
            const prior = heights.current.get(key);
            if (prior !== undefined && Math.abs(prior - height) < 1) continue;
            if (viewStart !== null && (latest.current.offsets[index + 1] ?? 0) <= viewStart) {
              anchorDelta += height - (prior ?? latest.current.estimate);
            }
            heights.current.set(key, height);
            changed = true;
          }
          if (!changed) return;
          if (scroller && anchorDelta) scroller.scrollTop += anchorDelta;
          setRevision((value) => value + 1);
        }),
      };
      measuring.current = state;
    }
    const state = measuring.current;
    const rows = new Map<Element, number>();
    let index = latest.current.range.start;
    for (const child of list.children) {
      if (!child.classList.contains(spacerClassName)) rows.set(child, index++);
    }
    for (const element of state.rows.keys()) if (!rows.has(element)) state.observer.unobserve(element);
    for (const element of rows.keys()) if (!state.rows.has(element)) state.observer.observe(element);
    state.rows = rows;
  });
  useEffect(
    () => () => {
      binding.current?.release();
      binding.current = null;
      measuring.current?.observer.disconnect();
      measuring.current = null;
    },
    [],
  );

  return { listRef, range, offsets, rowOffset, updateRange };
}
