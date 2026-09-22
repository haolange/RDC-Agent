// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useTranscriptScroll } from './useTranscriptScroll';
import { VirtualMessageList } from './VirtualMessageList';
import type { ConversationMessage } from '@shared/types/conversation';

it('follows streaming and resized content, respects a reader scrolling away, and releases observation', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(navigator, 'webdriver', { configurable: true, value: true });
  const disconnect = vi.fn();
  let resize!: ResizeObserverCallback;
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe = vi.fn();
    disconnect = disconnect;
  });
  const scrollTo = vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(() => {});
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  function Probe({ activity }: { activity: number }) {
    const { scrollContainerRef, handleScroll } = useTranscriptScroll(3, activity);
    return createElement('div', { ref: scrollContainerRef, onScroll: handleScroll }, createElement('ol'));
  }
  try {
    await act(async () => root.render(createElement(Probe, { activity: 1 })));
    const container = host.firstElementChild as HTMLElement;
    Object.defineProperties(container, { scrollHeight: { configurable: true, value: 2000 }, clientHeight: { value: 600 } });
    scrollTo.mockClear();
    await act(async () => root.render(createElement(Probe, { activity: 2 })));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 2000, behavior: 'auto' });
    scrollTo.mockClear();
    container.scrollTop = 600;
    await act(async () => container.dispatchEvent(new Event('scroll')));
    await act(async () => root.render(createElement(Probe, { activity: 3 })));
    resize([], {} as ResizeObserver);
    expect(scrollTo).not.toHaveBeenCalled();
    container.scrollTop = 1390;
    await act(async () => container.dispatchEvent(new Event('scroll')));
    Object.defineProperty(container, 'scrollHeight', { value: 2500 });
    resize([], {} as ResizeObserver);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 2500, behavior: 'auto' });
  } finally {
    await act(async () => root.unmount());
    expect(disconnect).toHaveBeenCalledTimes(1);
    host.remove();
    Reflect.deleteProperty(navigator, 'webdriver');
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it('observes virtual row growth after slice changes without forcing a reader back to the bottom', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const observers: TestObserver[] = [];
  class TestObserver {
    targets = new Set<Element>();
    disconnected = false;
    constructor(private callback: ResizeObserverCallback) { observers.push(this); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); this.disconnected = true; }
    resize(target: Element) {
      if (this.targets.has(target)) this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
  }
  vi.stubGlobal('ResizeObserver', TestObserver);
  const mutationDisconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
  const scrollTo = vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(() => {});
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const messages = Array.from({ length: 60 }, (_, index) => ({
    id: `message-${index}`, role: 'assistant', content: `Tool or image ${index}`,
  })) as ConversationMessage[];
  function Probe() {
    const { scrollContainerRef, handleScroll } = useTranscriptScroll(messages.length, 1);
    return createElement('div', { className: 'chat-messages', ref: scrollContainerRef, onScroll: handleScroll },
      createElement(VirtualMessageList, { messages,
        renderMessage: (message) => createElement('div', { 'data-message-id': message.id }, message.content),
      }));
  }
  const flushMutations = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  try {
    await act(async () => root.render(createElement(Probe)));
    const container = host.firstElementChild as HTMLElement;
    const list = container.querySelector('ol')!;
    let scrollHeight = 9600;
    Object.defineProperties(container, {
      scrollHeight: { get: () => scrollHeight }, clientHeight: { value: 320 },
    });
    vi.spyOn(list, 'getBoundingClientRect').mockImplementation(() => ({ top: -container.scrollTop }) as DOMRect);
    const firstRow = container.querySelector('.conversation-thread-item')!;
    container.scrollTop = 9280;
    await act(async () => container.dispatchEvent(new Event('scroll')));
    await flushMutations();
    const lastRow = container.querySelector('[data-message-id="message-59"]')!.parentElement!;
    expect(observers.some(observer => observer.targets.has(lastRow))).toBe(true);
    expect(observers.every(observer => !observer.targets.has(firstRow))).toBe(true);
    // Only the visible row resizes; the virtual ol remains 60 * 160px tall.
    scrollTo.mockClear();
    scrollHeight += 600 - 160;
    for (const observer of observers) observer.resize(lastRow);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 10040, behavior: 'auto' });
    container.scrollTop = 9000;
    await act(async () => container.dispatchEvent(new Event('scroll')));
    await flushMutations();
    scrollTo.mockClear();
    scrollHeight += 200;
    for (const observer of observers) observer.resize(lastRow);
    expect(scrollTo).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    expect(observers.every(observer => observer.disconnected && observer.targets.size === 0)).toBe(true);
    expect(mutationDisconnect).toHaveBeenCalled();
    host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
