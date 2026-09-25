import React from 'react';
import type { WorkProcessRow } from './workProcessTypes';
import { useDynStyle } from '../../lib/useDynStyle';
import { WORK_PROCESS_LOCATE_TASK_EVENT, type WorkProcessTaskLocationRequest } from '../../lib/workProcessTaskLocation';

const THRESHOLD = 24;
const ESTIMATE = 96;
const OVERSCAN = 4;

function indexAt(offsets: number[], value: number): number {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (offsets[mid] <= value) low = mid;
    else high = mid - 1;
  }
  return Math.min(low, offsets.length - 2);
}

const Spacer: React.FC<{ height: number }> = ({ height }) => {
  const dynStyle = useDynStyle({ height: `${Math.max(0, height)}px` });
  return <li className="work-process-row-spacer" aria-hidden="true" {...dynStyle} />;
};

/** Page-scroll windowing shared by parent and child Work Process lists. */
export const MeasuredWorkRows: React.FC<{
  rows: WorkProcessRow[];
  renderRow: (row: WorkProcessRow) => React.ReactNode;
  className: string;
}> = ({ rows, renderRow, className }) => {
  const listRef = React.useRef<HTMLOListElement>(null);
  const heights = React.useRef(new Map<string, number>());
  const [revision, setRevision] = React.useState(0);
  const [range, setRange] = React.useState({ start: 0, end: Math.min(rows.length, 12) });
  const offsets = [0];
  for (const row of rows) offsets.push(offsets[offsets.length - 1] + (heights.current.get(row.id) ?? ESTIMATE));
  const offsetsRef = React.useRef(offsets);
  offsetsRef.current = offsets;
  const updateRange = React.useCallback(() => {
    const list = listRef.current;
    const scroller = list?.closest('.chat-messages') as HTMLElement | null;
    if (!list || !scroller || rows.length <= THRESHOLD) return;
    const listTop = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const viewStart = Math.max(0, scroller.scrollTop - listTop);
    const viewEnd = viewStart + scroller.clientHeight;
    const start = Math.max(0, indexAt(offsetsRef.current, viewStart) - OVERSCAN);
    const end = Math.min(rows.length, indexAt(offsetsRef.current, viewEnd) + OVERSCAN + 1);
    setRange((current) => current.start === start && current.end === end ? current : { start, end });
  }, [rows.length]);

  React.useEffect(() => {
    const scroller = listRef.current?.closest('.chat-messages') as HTMLElement | null;
    if (!scroller) return;
    scroller.addEventListener('scroll', updateRange, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateRange);
    observer?.observe(scroller);
    updateRange();
    return () => { scroller.removeEventListener('scroll', updateRange); observer?.disconnect(); };
  }, [updateRange]);
  React.useEffect(updateRange, [rows.length, revision, updateRange]);

  React.useEffect(() => {
    const locate = (event: Event) => {
      const detail = (event as CustomEvent<WorkProcessTaskLocationRequest>).detail;
      const list = listRef.current;
      if (!list || !detail?.taskId) return;
      let index = -1;
      for (let candidate = rows.length - 1; candidate >= 0; candidate -= 1) {
        const row = rows[candidate];
        if (row.type === 'taskSnapshot' && row.items.some((item) => item.taskId === detail.taskId)) {
          index = candidate;
          break;
        }
      }
      if (index < 0) return;
      const rowId = rows[index].id;
      detail.candidates.push({ element: list, reveal: () => {
        const scroller = list.closest('.chat-messages') as HTMLElement | null;
        if (scroller && rows.length > THRESHOLD) {
          const listTop = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
          scroller.scrollTop = listTop + (offsetsRef.current[index] ?? 0);
          updateRange();
        }
        const focus = (attempt: number) => {
          const card = [...list.children].find((child) => child.getAttribute('data-work-process-block-id') === rowId);
          if (!card) {
            if (attempt < 12) requestAnimationFrame(() => focus(attempt + 1));
            return;
          }
          const target = [...card.querySelectorAll<HTMLElement>('[data-work-process-task-id]')]
            .find((item) => item.dataset.workProcessTaskId === detail.taskId);
          if (!target) {
            const trigger = card.querySelector<HTMLButtonElement>('.work-card-trigger[aria-expanded="false"]');
            if (trigger && attempt < 12) {
              trigger.click();
              requestAnimationFrame(() => focus(attempt + 1));
            }
            return;
          }
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.focus({ preventScroll: true });
          target.classList.remove('is-trace-flash');
          void target.offsetWidth;
          target.classList.add('is-trace-flash');
          window.setTimeout(() => target.classList.remove('is-trace-flash'), 1600);
        };
        focus(0);
      } });
    };
    document.addEventListener(WORK_PROCESS_LOCATE_TASK_EVENT, locate);
    return () => document.removeEventListener(WORK_PROCESS_LOCATE_TASK_EVENT, locate);
  }, [rows, updateRange]);

  React.useEffect(() => {
    if (rows.length <= THRESHOLD || typeof ResizeObserver === 'undefined') return;
    const list = listRef.current;
    if (!list) return;
    const scroller = list.closest('.chat-messages') as HTMLElement | null;
    const children = [...list.children].filter((child) => !child.classList.contains('work-process-row-spacer')) as HTMLElement[];
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      let anchorDelta = 0;
      const listTop = scroller
        ? list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop : 0;
      const viewStart = scroller ? scroller.scrollTop - listTop : 0;
      for (const entry of entries) {
        const index = children.indexOf(entry.target as HTMLElement);
        const row = rows[range.start + index];
        if (index < 0 || !row) continue;
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
        if (!Number.isFinite(height) || height <= 0) continue;
        const prior = heights.current.get(row.id);
        if (prior === undefined || Math.abs(prior - height) >= 1) {
          const rowEnd = offsetsRef.current[range.start + index + 1] ?? 0;
          if (scroller && rowEnd <= viewStart) anchorDelta += height - (prior ?? ESTIMATE);
          heights.current.set(row.id, height);
          changed = true;
        }
      }
      if (changed) {
        if (scroller && anchorDelta) scroller.scrollTop += anchorDelta;
        setRevision((value) => value + 1);
      }
    });
    children.forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [rows, range.start, range.end]);

  if (rows.length <= THRESHOLD) return <ol ref={listRef} className={className}>{rows.map(renderRow)}</ol>;
  return <ol ref={listRef} className={className} data-virtualized="true">
    {range.start > 0 ? <Spacer height={offsets[range.start] ?? 0} /> : null}
    {rows.slice(range.start, range.end).map(renderRow)}
    {range.end < rows.length ? <Spacer height={Math.max(0, offsets[rows.length] - (offsets[range.end] ?? 0))} /> : null}
  </ol>;
};
