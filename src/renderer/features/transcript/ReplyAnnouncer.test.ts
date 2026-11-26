// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useConversationStore } from '../../stores/conversationStore';
import { ReplyAnnouncer, announcementText } from './ReplyAnnouncer';
import type { ConversationMessage, ConversationMessageStatus } from '@shared/types/conversation';

vi.mock('../../i18n', () => ({
  useI18n: () => ({ t: (_key: string, params: { text: string }) => `Reply: ${params.text}` }),
}));
let host: HTMLDivElement;
let root: Root;
const initial = useConversationStore.getState();
const reply = (
  id: string,
  content: string,
  status: ConversationMessageStatus,
  sessionId = 'a',
): ConversationMessage => ({
  id,
  turnId: id,
  sessionId,
  projectId: 'p',
  role: 'assistant',
  content,
  status,
  createdAt: 1,
});
const show = (messages: ConversationMessage[]) =>
  act(() => useConversationStore.setState({ conversationMessages: messages }));
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  useConversationStore.setState(initial, true);
  host.remove();
  vi.unstubAllGlobals();
});

it('reads each reply once it settles and keeps opened history silent', () => {
  show([reply('old', 'Earlier answer', 'complete')]);
  act(() => root.render(createElement(ReplyAnnouncer)));
  const region = host.querySelector('[data-testid="transcript-reply-announcer"]')!;
  expect(region.getAttribute('aria-live')).toBe('polite');
  expect(region.textContent).toBe('');

  show([reply('old', 'Earlier answer', 'complete'), reply('new', 'The **draw** is', 'streaming')]);
  expect(region.textContent).toBe('');
  show([reply('old', 'Earlier answer', 'complete'), reply('new', 'The **draw** is culled by [depth](x).', 'complete')]);
  expect(region.textContent).toBe('Reply: The draw is culled by depth.');

  // Another session's saved replies are history too.
  show([reply('other', 'Saved answer', 'complete', 'b')]);
  expect(region.textContent).toBe('Reply: The draw is culled by depth.');
});

it('caps a long reply at a word boundary', () => {
  const text = announcementText(`${'word '.repeat(100)}end`);
  expect(text.length).toBeLessThanOrEqual(301);
  expect(text.endsWith('word…')).toBe(true);
});
