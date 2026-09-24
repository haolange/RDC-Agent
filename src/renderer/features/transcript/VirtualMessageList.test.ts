// @vitest-environment happy-dom
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import { VirtualMessageList, measuredMessageOffsets } from './VirtualMessageList';

it('positions expanded messages using measured heights', () => {
  expect(measuredMessageOffsets([{ id: 'a' }, { id: 'b' }, { id: 'c' }], new Map([['b', 640]]), 160))
    .toEqual([0, 160, 800, 960]);
});

it('renders short state samples and windows a long conversation while releasing listeners and observers', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const observers: { disconnected: boolean }[] = [];
  vi.stubGlobal('ResizeObserver', class {
    disconnected = false;
    constructor() { observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  });
  const host = document.createElement('div');
  host.className = 'chat-messages';
  document.body.append(host);
  Object.defineProperty(host, 'clientHeight', { value: 320 });
  const root = createRoot(host);
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const messages = Array.from({ length: 100 }, (_, index) => ({
    id: `message-${index}`, role: index % 2 ? 'assistant' : 'user',
    status: index % 3 === 0 ? 'error' : 'complete', content: `Message ${index}`,
  })) as ConversationMessage[];
  messages[75] = { ...messages[75], projectId: 'project', sessionId: 'session',
    workTrace: { blocks: [{ toolCalls: [{ id: 'tool-target' }] }] },
  } as ConversationMessage;
  const render = (items: ConversationMessage[]) => act(async () => root.render(createElement(StrictMode, null,
    createElement(VirtualMessageList, { messages: items, estimateHeight: 160, overscan: 2,
      renderMessage: (message) => createElement('span', { 'data-message-id': message.id }, message.content),
    }))));
  try {
    await render(messages.slice(0, 3));
    expect(host.querySelector('ol')?.dataset.virtualized).toBe('false');
    expect(host.querySelectorAll('[data-message-id]')).toHaveLength(3);
    expect(host.querySelector('[data-message-status="error"]')).not.toBeNull();
    await render(messages);
    const list = host.querySelector('ol')!;
    vi.spyOn(list, 'getBoundingClientRect').mockImplementation(() => ({ top: -host.scrollTop }) as DOMRect);
    host.scrollTop = 8000;
    await act(async () => host.dispatchEvent(new Event('scroll')));
    expect(list.dataset.virtualized).toBe('true');
    expect(host.querySelectorAll('[data-message-id]')).toHaveLength(7);
    expect(host.querySelector('[data-message-id="message-50"]')).not.toBeNull();
    expect(host.querySelector('[data-message-id="message-0"]')).toBeNull();
    const locate = () => window.dispatchEvent(new CustomEvent('rdc:locate-tool-call', {
      detail: { projectId: 'project', sessionId: 'session', toolCallId: 'tool-target' },
    }));
    await act(async () => { locate(); locate(); });
    expect(frames.size).toBe(1);
    expect(host.querySelector('[data-message-id="message-75"]')).not.toBeNull();
    const callback = [...frames.values()][0];
    frames.clear();
    await act(async () => callback(0));
    expect(document.activeElement?.getAttribute('data-message-id')).toBe('message-75');
    await act(async () => locate());
    await render(messages.slice(0, 2));
    expect(frames.size).toBe(0);
    expect(host.querySelectorAll('[data-message-id]')).toHaveLength(2);
  } finally {
    await act(async () => root.unmount());
    expect(observers.every((observer) => observer.disconnected)).toBe(true);
    host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
