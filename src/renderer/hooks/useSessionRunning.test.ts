// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useConversationStore } from '../stores/conversationStore';
import { useProjectStore } from '../stores/projectStore';
import { useSessionProjectionStore } from '../stores/sessionProjectionStore';
import { useSessionRunning } from './useSessionRunning';
import type { ConversationMessage } from '@shared/types/conversation';

const reply = (status: ConversationMessage['status'], sessionId = 'other'): ConversationMessage => ({
  id: 'm', sessionId, projectId: 'p', turnId: 't', role: 'assistant', status, content: '', createdAt: 1,
});

afterEach(() => {
  useProjectStore.setState({ currentSessionId: null });
  useConversationStore.setState({ allConversationMessages: [] });
  useSessionProjectionStore.getState().reset();
  vi.unstubAllGlobals();
});

it('reads the open session live and other sessions from their projection', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const seen: Record<string, boolean> = {};
  const Probe = ({ id }: { id: string }) => { seen[id] = useSessionRunning(id); return null; };
  useProjectStore.setState({ currentSessionId: 'open' });
  useConversationStore.setState({ allConversationMessages: [reply('streaming', 'open')] });
  useSessionProjectionStore.getState().projectConversationMessage('other', reply('complete'));
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(createElement('div', null, createElement(Probe, { id: 'open' }), createElement(Probe, { id: 'other' }))));
  expect(seen).toEqual({ open: true, other: false });
  await act(async () => { useSessionProjectionStore.getState().projectConversationMessage('other', reply('streaming')); });
  expect(seen.other).toBe(true);
  await act(async () => root.unmount());
});
