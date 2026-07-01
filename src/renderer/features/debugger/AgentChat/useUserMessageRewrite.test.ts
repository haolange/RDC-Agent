import { afterEach, describe, expect, it } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import { useConversationStore } from '../../../stores/conversationStore';
import { isRewriteTurnStillCurrent } from './useUserMessageRewrite';

const userMessage: ConversationMessage = {
  id: 'user-new',
  turnId: 'turn-new',
  sessionId: 'session-1',
  projectId: 'project-1',
  role: 'user',
  content: 'edited prompt',
  status: 'complete',
  createdAt: 1,
  updatedAt: 1,
};

describe('isRewriteTurnStillCurrent', () => {
  afterEach(() => {
    useConversationStore.getState().reset();
  });

  it('accepts background sync only while the rewrite turn is still on the active branch', () => {
    useConversationStore.getState().setConversationMessages([userMessage]);
    useConversationStore.getState().setBranchState({
      sessionId: 'session-1',
      rootBranchId: 'branch-root',
      activeLeafBranchId: 'branch-new',
      forks: [],
    });

    expect(isRewriteTurnStillCurrent('turn-new', 'branch-new')).toBe(true);

    useConversationStore.getState().setBranchState({
      sessionId: 'session-1',
      rootBranchId: 'branch-root',
      activeLeafBranchId: 'branch-newer',
      forks: [],
    });

    expect(isRewriteTurnStillCurrent('turn-new', 'branch-new')).toBe(false);
  });

  it('rejects background sync when the accepted rewrite turn is no longer visible', () => {
    useConversationStore.getState().setConversationMessages([]);

    expect(isRewriteTurnStillCurrent('turn-new', null)).toBe(false);
  });
});
