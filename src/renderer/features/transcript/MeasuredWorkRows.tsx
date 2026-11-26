import React from 'react';
import { useWindowedList } from '../../lib/useWindowedList';
import { WindowedListSpacer } from '../../lib/WindowedListSpacer';
import { WORK_PROCESS_LOCATE_TASK_EVENT, type WorkProcessTaskLocationRequest } from '../../lib/workProcessTaskLocation';
import { motionScrollBehavior } from '../../lib/motion';
import { useWorkProcessFolded } from './workProcessFold';
import type { WorkProcessRow } from './workProcessTypes';

const THRESHOLD = 24;
const ESTIMATE = 96;
const OVERSCAN = 4;
const SPACER_CLASS = 'work-process-row-spacer';

/** A following Working window scrolls on its own; elsewhere the transcript is the scroller. */
const nearestScroller = (list: HTMLElement): HTMLElement | null =>
  list.closest<HTMLElement>('.work-process-viewport.is-following > .work-process-viewport-scroller, .chat-messages');

/** Scroll windowing shared by parent and child Work Process lists. */
export const MeasuredWorkRows: React.FC<{
  rows: WorkProcessRow[];
  renderRow: (row: WorkProcessRow) => React.ReactNode;
  className: string;
}> = ({ rows, renderRow, className }) => {
  // A folded Working shows none of its rows (its body is not displayed), so it mounts none; unfolding mounts the window.
  const folded = useWorkProcessFolded();
  const windowed = rows.length > THRESHOLD && !folded;
  const keys = React.useMemo(() => rows.map((row) => row.id), [rows]);
  const { listRef, range, offsets, rowOffset, updateRange } = useWindowedList<HTMLOListElement>({
    keys,
    enabled: windowed,
    estimate: ESTIMATE,
    overscan: OVERSCAN,
    initialCount: 12,
    scrollerOf: nearestScroller,
    spacerClassName: SPACER_CLASS,
    anchorAbove: true,
  });

  React.useEffect(() => {
    const locate = (event: Event) => {
      const detail = (event as CustomEvent<WorkProcessTaskLocationRequest>).detail;
      const list = listRef.current;
      if (!list || !detail.taskId) return;
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
      detail.candidates.push({
        element: list,
        reveal: () => {
          const scroller = nearestScroller(list);
          if (scroller && windowed) {
            const listTop =
              list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
            scroller.scrollTop = listTop + rowOffset(index);
            updateRange();
          }
          const focus = (attempt: number) => {
            const card = [...list.children].find((child) => child.getAttribute('data-work-process-block-id') === rowId);
            if (!card) {
              if (attempt < 12) requestAnimationFrame(() => focus(attempt + 1));
              return;
            }
            const target = [...card.querySelectorAll<HTMLElement>('[data-work-process-task-id]')].find(
              (item) => item.dataset.workProcessTaskId === detail.taskId,
            );
            if (!target) {
              const trigger = card.querySelector<HTMLButtonElement>('.work-card-trigger[aria-expanded="false"]');
              if (trigger && attempt < 12) {
                trigger.click();
                requestAnimationFrame(() => focus(attempt + 1));
              }
              return;
            }
            const reason = target.querySelector('details');
            if (reason) reason.open = true;
            target.scrollIntoView({ behavior: motionScrollBehavior(), block: 'center' });
            target.focus({ preventScroll: true });
            target.classList.remove('is-trace-flash');
            void target.offsetWidth;
            target.classList.add('is-trace-flash');
            window.setTimeout(() => target.classList.remove('is-trace-flash'), 1600);
          };
          focus(0);
        },
      });
    };
    document.addEventListener(WORK_PROCESS_LOCATE_TASK_EVENT, locate);
    return () => document.removeEventListener(WORK_PROCESS_LOCATE_TASK_EVENT, locate);
  }, [listRef, rowOffset, rows, updateRange, windowed]);

  if (folded) return <ol ref={listRef} className={className} />;
  if (!windowed)
    return (
      <ol ref={listRef} className={className}>
        {rows.map(renderRow)}
      </ol>
    );
  return (
    <ol ref={listRef} className={className} data-virtualized="true">
      {range.start > 0 ? <WindowedListSpacer className={SPACER_CLASS} height={offsets[range.start] ?? 0} /> : null}
      {rows.slice(range.start, range.end).map(renderRow)}
      {range.end < rows.length ? (
        <WindowedListSpacer className={SPACER_CLASS} height={offsets[rows.length] - (offsets[range.end] ?? 0)} />
      ) : null}
    </ol>
  );
};
