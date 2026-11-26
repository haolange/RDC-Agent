// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { WorkProcessViewport } from './WorkProcessViewport';
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

it('reads the scroll position once per frame, not in the scroll event, and keeps following content added that frame', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  let resize!: ResizeObserverCallback;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    frames.delete(id);
  });
  const runFrame = () =>
    act(async () => {
      const due = [...frames.values()];
      frames.clear();
      due.forEach((callback) => callback(performance.now()));
    });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let reads = 0;
  let scrollHeight = 1000;
  let scrollTop = 0;
  const geometry = (scroller: HTMLElement) =>
    Object.defineProperties(scroller, {
      scrollHeight: {
        configurable: true,
        get: () => {
          reads += 1;
          return scrollHeight;
        },
      },
      clientHeight: {
        configurable: true,
        get: () => {
          reads += 1;
          return 200;
        },
      },
      scrollTop: {
        configurable: true,
        get: () => {
          reads += 1;
          return scrollTop;
        },
        set: (value: number) => {
          scrollTop = value;
        },
      },
    });
  try {
    await act(async () => root.render(createElement(WorkProcessViewport, { following: true, children: 'rows' })));
    const scroller = host.querySelector<HTMLElement>('.work-process-viewport-scroller')!;
    geometry(scroller);
    resize([], {} as ResizeObserver);
    expect(scrollTop).toBe(800);

    // The reader scrolls up: the event reads nothing, the next frame pauses following.
    scrollTop = 300;
    reads = 0;
    await act(async () => scroller.dispatchEvent(new Event('scroll')));
    expect(reads).toBe(0);
    expect(host.querySelector('.work-process-viewport-latest')).toBeNull();
    await runFrame();
    expect(host.querySelector('.work-process-viewport-latest')).not.toBeNull();

    // Back at the bottom, and content grows before the frame reads the position: following continues.
    scrollTop = 800;
    await act(async () => scroller.dispatchEvent(new Event('scroll')));
    scrollHeight = 1400;
    await runFrame();
    expect(host.querySelector('.work-process-viewport-latest')).toBeNull();
    resize([], {} as ResizeObserver);
    expect(scrollTop).toBe(1200);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
