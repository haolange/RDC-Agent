import { beforeEach, describe, expect, it } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import { useConversationStore } from './conversationStore';
import { useWorkflowStore } from './workflowStore';
import { useCaptureStore } from './captureStore';
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
    useCaptureStore.getState().reset();
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

  it('hydrates only the cached session context and opened capture', () => {
    const contextSnapshot = {
      contextId: 'context-a',
      sessionId: 'session-a',
      backend: 'local',
      runtimeOwner: 'owner-a',
      ownerLeaseId: 'lease-a',
      activeCapture: 'capture-a',
      deviceLabel: 'Local',
      captureDescriptors: [{ id: 'capture-a', filePath: 'D:/a.rdc', role: 'primary', backendHint: 'local', status: 'open' }],
    } as never;
    const openedCapture = {
      projectId: 'project-a',
      ownerSessionId: 'session-a',
      filePath: 'D:/a.rdc',
      status: 'open',
    } as never;
    const projection = useSessionProjectionStore.getState();
    projection.projectContextSnapshot('session-a', contextSnapshot);
    projection.projectOpenedCapture('session-a', openedCapture);

    expect(projection.activateSession('session-a')).toBe(true);
    expect(useCaptureStore.getState().contextSnapshot?.contextId).toBe('context-a');
    expect(useCaptureStore.getState().openedCapture?.projectId).toBe('project-a');
    expect(useCaptureStore.getState().captures.map((capture) => capture.id)).toEqual(['capture-a']);
  });
  it('evictSession removes cache', () => {
    useSessionProjectionStore.getState().projectConversationMessage('session-a', message());
    useSessionProjectionStore.getState().evictSession('session-a');
    expect(useSessionProjectionStore.getState().activateSession('session-a')).toBe(false);
  });
});
