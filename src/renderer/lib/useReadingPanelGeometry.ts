import { useLayoutEffect, useState } from 'react';
import { useWorkbenchReadingLayout } from './WorkbenchReadingLayout';
import { useDynStyle } from './useDynStyle';

interface ReadingBounds { left: number; top: number; width: number; height: number }

export function readingBounds(workArea: DOMRect, rail: DOMRect, viewportWidth: number, viewportHeight: number): ReadingBounds | null {
  const left = Math.max(0, rail.left);
  const right = Math.min(viewportWidth, rail.right);
  const top = Math.max(0, workArea.top);
  const bottom = Math.min(viewportHeight, workArea.bottom);
  return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } : null;
}

export function useReadingPanelGeometry() {
  const layout = useWorkbenchReadingLayout();
  const [bounds, setBounds] = useState<ReadingBounds | null>(null);
  useLayoutEffect(() => {
    const area = layout?.workArea.current;
    const rail = layout?.composerRail.current;
    if (!area || !rail) { setBounds(null); return; }
    let frame = 0;
    const measure = () => {
      const next = readingBounds(area.getBoundingClientRect(), rail.getBoundingClientRect(), window.innerWidth, window.innerHeight);
      setBounds((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    // Observe the shell as well: moving a same-sized rail is a position change.
    [area, rail, area.parentElement].forEach((element) => { if (element) observer.observe(element); });
    const mutations = new MutationObserver(schedule);
    mutations.observe(area, { attributes: true });
    if (area.parentElement) mutations.observe(area.parentElement, { attributes: true });
    mutations.observe(document.documentElement, { attributes: true });
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    area.addEventListener('transitionend', schedule);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      area.removeEventListener('transitionend', schedule);
    };
  }, [layout]);
  const style = useDynStyle(bounds ? {
    '--reading-left': `${bounds.left}px`, '--reading-top': `${bounds.top}px`,
    '--reading-width': `${bounds.width}px`, '--reading-height': `${bounds.height}px`,
  } : {});
  return { ready: bounds !== null, style };
}
