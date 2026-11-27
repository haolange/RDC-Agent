// @vitest-environment happy-dom
import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { useWindowedList, windowOffsets } from './useWindowedList';

it('positions rows using measured heights and the estimate for the rest', () => {
  expect(windowOffsets(['a', 'b', 'c'], new Map([['b', 640]]), 160)).toEqual([0, 160, 800, 960]);
});

function Rows({ keys, scroller }: { keys: string[]; scroller: HTMLElement }) {
  const { listRef, range } = useWindowedList<HTMLDivElement>({
    keys,
    enabled: true,
    estimate: 100,
    overscan: 0,
    initialCount: 3,
    scrollerOf: () => scroller,
    spacerClassName: 'spacer',
  });
  return React.createElement(
    'div',
    { ref: listRef },
    keys.slice(range.start, range.end).map((key) => React.createElement('div', { key, 'data-row': key })),
  );
}

it('mounts a row appended at the bottom in the same commit, before any paint', () => {
  const scroller = document.createElement('div');
  document.body.append(scroller);
  Object.defineProperty(scroller, 'clientHeight', { value: 300 });
  const host = document.createElement('div');
  scroller.append(host);
  // The list sits at the scroller's top; scrolling moves it up by scrollTop, as a browser lays it out.
  const listTop = () => -scroller.scrollTop;
  const root = createRoot(host);
  const keys = Array.from({ length: 10 }, (_, index) => `row-${index}`);
  try {
    flushSync(() => root.render(React.createElement(Rows, { keys, scroller })));
    host.firstElementChild!.getBoundingClientRect = () => ({ top: listTop() }) as DOMRect;
    scroller.scrollTop = 700; // pinned to the bottom of ten 100px rows
    flushSync(() => root.render(React.createElement(Rows, { keys: [...keys], scroller })));
    flushSync(() => root.render(React.createElement(Rows, { keys: [...keys, 'row-10'], scroller })));
    // flushSync runs layout effects and the renders they schedule, not passive effects.
    expect(host.querySelector('[data-row="row-10"]')).not.toBeNull();
  } finally {
    flushSync(() => root.unmount());
    scroller.remove();
  }
});
