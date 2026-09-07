import { describe, expect, it } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import { resolveVisibleConversationMessages } from '@shared/conversation/conversationBranchResolver';
import { buildOptimisticRewriteSnapshot } from './optimisticRewriteSnapshot';

const user = (overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id: 'user-1',
  turnId: 'turn-1',
  sessionId: 'session-1',
  projectId: 'project-1',
  role: 'user',
  content: 'original',
  status: 'complete',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const assistant = (overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id: 'assistant-1',
  turnId: 'turn-1',
  sessionId: 'session-1',
  projectId: 'project-1',
  role: 'assistant',
  content: 'answer',
  status: 'complete',
  createdAt: 2,
  updatedAt: 2,
  ...overrides,
});

describe('buildOptimisticRewriteSnapshot', () => {
  it('switches visible leaf to the optimistic rewrite variant immediately', () => {
    const source = user();
    const snapshot = buildOptimisticRewriteSnapshot({
      requestId: 'req-rewrite',
      sourceMessage: source,
      nextContent: 'edited prompt',
      allMessages: [source, assistant()],
      branchState: null,
      agentId: 'debugger',
    });

    expect(snapshot.branchState.activeLeafBranchId).toBe(snapshot.optimisticBranchId);
    const visible = resolveVisibleConversationMessages(snapshot.messages, snapshot.branchState);
    expect(visible.some((message) => message.content === 'edited prompt')).toBe(true);
    expect(visible.some((message) => (
      message.role === 'assistant' && message.status === 'streaming'
    ))).toBe(true);
  });
});
