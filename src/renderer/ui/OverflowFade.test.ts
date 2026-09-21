// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverflowFade } from './OverflowFade';

let resizeCallback: ResizeObserverCallback | null = null;
let disconnected = false;

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
};

const installFontSet = (ready: Promise<FontFaceSet>) => {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const addEventListener = vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => listeners.add(listener));
  const removeEventListener = vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => listeners.delete(listener));
  const fontSet = { ready, addEventListener, removeEventListener } as unknown as FontFaceSet;
  Object.defineProperty(document, 'fonts', { configurable: true, value: fontSet });
  return {
    addEventListener,
    removeEventListener,
    dispatchLoadingDone: () => {
      const event = new Event('loadingdone');
      listeners.forEach((listener) => {
        if (typeof listener === 'function') listener(event);
        else listener.handleEvent(event);
      });
    },
    listenerCount: () => listeners.size,
  };
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  resizeCallback = null;
  disconnected = false;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
    observe() {}
    disconnect() { disconnected = true; }
    unobserve() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('OverflowFade', () => {
  it('keeps the complete text and title while toggling both ways for the same text width', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    let root: Root;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(OverflowFade, { text: 'Complete model name' }));
    });
    const text = container.querySelector<HTMLElement>('.ui-overflow-fade')!;
    Object.defineProperties(text, {
      clientWidth: { configurable: true, value: 80 },
      scrollWidth: { configurable: true, value: 160 },
    });
    await act(async () => { resizeCallback?.([], {} as ResizeObserver); });
    expect(text.classList.contains('is-overflowing')).toBe(true);
    expect(text.textContent).toBe('Complete model name');
    expect(text.title).toBe('Complete model name');

    Object.defineProperty(text, 'scrollWidth', { configurable: true, value: 60 });
    await act(async () => { resizeCallback?.([], {} as ResizeObserver); });
    expect(text.classList.contains('is-overflowing')).toBe(false);

    Object.defineProperty(text, 'scrollWidth', { configurable: true, value: 140 });
    await act(async () => { resizeCallback?.([], {} as ResizeObserver); });
    expect(text.classList.contains('is-overflowing')).toBe(true);

    Object.defineProperty(text, 'scrollWidth', { configurable: true, value: 60 });
    await act(async () => {
      root.render(createElement(OverflowFade, { text: 'Short' }));
    });
    expect(text.classList.contains('is-overflowing')).toBe(false);
    expect(text.textContent).toBe('Short');
    act(() => root.unmount());
    expect(disconnected).toBe(true);
  });

  it('remeasures on font loading completion and when fonts.ready resolves', async () => {
    const fontsReady = deferred<FontFaceSet>();
    const fonts = installFontSet(fontsReady.promise);
    const container = document.createElement('div');
    document.body.append(container);
    let root: Root;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(OverflowFade, { text: 'Font-sensitive label' }));
    });
    const text = container.querySelector<HTMLElement>('.ui-overflow-fade')!;
    let scrollWidth = 140;
    Object.defineProperties(text, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, get: () => scrollWidth },
    });

    await act(async () => fonts.dispatchLoadingDone());
    expect(text.classList.contains('is-overflowing')).toBe(true);

    scrollWidth = 80;
    await act(async () => fontsReady.resolve(document.fonts));
    expect(text.classList.contains('is-overflowing')).toBe(false);
    expect(fonts.addEventListener).toHaveBeenCalledWith('loadingdone', expect.any(Function));
    await act(async () => root.unmount());
  });

  it('removes the font listener and ignores late font events and ready completion after unmount', async () => {
    const fontsReady = deferred<FontFaceSet>();
    const fonts = installFontSet(fontsReady.promise);
    const container = document.createElement('div');
    document.body.append(container);
    let root: Root;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(OverflowFade, { text: 'Unmounted label' }));
    });
    const text = container.querySelector<HTMLElement>('.ui-overflow-fade')!;
    let measurementCount = 0;
    Object.defineProperties(text, {
      clientWidth: { configurable: true, value: 100 },
      scrollWidth: { configurable: true, get: () => { measurementCount += 1; return 140; } },
    });
    await act(async () => fonts.dispatchLoadingDone());
    expect(measurementCount).toBe(1);

    await act(async () => root.unmount());
    expect(fonts.listenerCount()).toBe(0);
    expect(fonts.removeEventListener).toHaveBeenCalledWith('loadingdone', expect.any(Function));
    const countAfterUnmount = measurementCount;
    await act(async () => {
      fonts.dispatchLoadingDone();
      fontsReady.resolve(document.fonts);
      await fontsReady.promise;
    });
    expect(measurementCount).toBe(countAfterUnmount);
  });

  it('retains the single-line element and title contract for an empty string', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    let root: Root;
    await act(async () => {
      root = createRoot(container);
      root.render(createElement(OverflowFade, { text: '' }));
    });
    const text = container.querySelector<HTMLElement>('.ui-overflow-fade')!;
    expect(text.textContent).toBe('');
    expect(text.title).toBe('');
    expect(text.classList.contains('ui-overflow-fade')).toBe(true);
    await act(async () => root.unmount());
  });
});
