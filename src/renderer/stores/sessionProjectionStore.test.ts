import { beforeEach, describe, expect, it } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import { useConversationStore } from './conversationStore';
import { useWorkflowStore } from './workflowStore';
import { useSessionProjectionStore } from './sessionProjectionStore';

const message = (overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id: 'msg-1',
  turnId: 'turn-1',
  sessionId: 'session-a',
  projectId: 'project-1',
  role: 'assistant',
  content: 'from a',
  status: 'streaming',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('sessionProjectionStore', () => {
  beforeEach(() => {
    useConversationStore.getState().reset();
    useWorkflowStore.getState().reset();
    useSessionProjectionStore.getState().reset();
  });

  it('caches background conversation patches and hydrates on activate', () => {
    useSessionProjectionStore.getState().projectConversationMessage(
      'session-a',
      message({ content: 'cached stream', updatedAt: 2 }),
    );
    expect(useConversationStore.getState().conversationMessages).toHaveLength(0);

    const hydrated = useSessionProjectionStore.getState().activateSession('session-a');
    expect(hydrated).toBe(true);
    expect(useConversationStore.getState().conversationMessages[0]?.content).toBe('cached stream');
  });

  it('captureActiveSession snapshots current UI into cache', () => {
    useConversationStore.getState().upsertConversationMessage(message({ content: 'active' }));
    useSessionProjectionStore.getState().captureActiveSession('session-a');
    useConversationStore.getState().reset();

    expect(useSessionProjectionStore.getState().activateSession('session-a')).toBe(true);
    expect(useConversationStore.getState().conversationMessages[0]?.content).toBe('active');
  });

  it('evictSession removes cache', () => {
    useSessionProjectionStore.getState().projectConversationMessage('session-a', message());
    useSessionProjectionStore.getState().evictSession('session-a');
    expect(useSessionProjectionStore.getState().activateSession('session-a')).toBe(false);
  });
});
