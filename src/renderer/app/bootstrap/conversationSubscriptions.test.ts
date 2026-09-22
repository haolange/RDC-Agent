// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ElectronAPI } from '@shared/types/electron';
import type { ConversationMessage, ConversationStreamEvent } from '@shared/types/conversation';
import { subscribeConversation } from './conversationSubscriptions';

const state = vi.hoisted(() => ({
  currentSession: 'a',
  conversation: { upsertConversationMessage: vi.fn(), patchAssistantMessageByTurnId: vi.fn(), addTimelineEntry: vi.fn() },
  projection: { projectConversationMessage: vi.fn(), projectConversationTerminal: vi.fn() },
  session: { markConversationTurnTerminal: vi.fn() },
}));
vi.mock('../../stores/conversationStore', () => ({ useConversationStore: { getState: () => state.conversation } }));
vi.mock('../../stores/sessionProjectionStore', () => ({ useSessionProjectionStore: { getState: () => state.projection } }));
vi.mock('../../stores/sessionStore', () => ({ useSessionStore: { getState: () => state.session } }));
vi.mock('../../stores/sessionEventGate', () => ({ isActiveSessionEvent: (id: string) => id === state.currentSession }));

function setup() {
  let event!: (value: ConversationStreamEvent) => void;
  const offEvent = vi.fn();
  const api = { conversation: { onEvent: (callback: typeof event) => { event = callback; }, offEvent } };
  const subscription = subscribeConversation(api as unknown as ElectronAPI, vi.fn(), (key) => key);
  return { event, offEvent, subscription };
}
const message: ConversationMessage = {
  id: 'message', turnId: 'turn', sessionId: 'a', projectId: null,
  role: 'assistant', content: 'partial', status: 'streaming', createdAt: 1, updatedAt: 2,
};

describe('conversation stream ownership and cleanup', () => {
  beforeEach(() => { vi.clearAllMocks(); state.currentSession = 'a'; });

  it('projects background terminal messages without modifying active conversation state', () => {
    const { event, subscription } = setup();
    event({ type: 'message_completed', sessionId: 'b', turnId: 'turn', message: { ...message, sessionId: 'b', status: 'complete' } });
    expect(state.projection.projectConversationMessage).toHaveBeenCalledWith('b', expect.objectContaining({ sessionId: 'b' }));
    expect(state.projection.projectConversationTerminal).toHaveBeenCalledWith('b', 'turn', true);
    expect(state.conversation.upsertConversationMessage).not.toHaveBeenCalled();
    expect(state.session.markConversationTurnTerminal).not.toHaveBeenCalled();
    subscription.disposeBatcher(); subscription.unsubscribe();
  });

  it('checks ownership again when a queued frame runs after session switching', () => {
    let frame!: FrameRequestCallback;
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 1; });
    const { event, subscription } = setup();
    event({ type: 'message_patched', sessionId: 'a', turnId: 'turn', message });
    state.currentSession = 'b';
    frame(0);
    expect(state.projection.projectConversationMessage).toHaveBeenCalledWith('a', message);
    expect(state.conversation.upsertConversationMessage).not.toHaveBeenCalled();
    subscription.disposeBatcher(); subscription.unsubscribe(); raf.mockRestore();
  });

  it('cancels pending frame and removes exactly the installed listener on cleanup', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(7);
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { event, subscription, offEvent } = setup();
    event({ type: 'message_patched', sessionId: 'a', turnId: 'turn', message });
    subscription.disposeBatcher(); subscription.unsubscribe();
    expect(cancel).toHaveBeenCalledWith(7);
    expect(offEvent).toHaveBeenCalledWith(event);
    expect(state.conversation.upsertConversationMessage).not.toHaveBeenCalled();
    raf.mockRestore(); cancel.mockRestore();
  });
});
