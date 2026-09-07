import { beforeEach, describe, expect, it } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import { ROOT_BRANCH_ID } from '@shared/types/conversationBranch';
import { resolveVisibleConversationMessages } from '@shared/conversation/conversationBranchResolver';
import { useConversationStore } from '../../stores/conversationStore';

const now = 1_700_000_000_000;

const msg = (
  id: string,
  turnId: string,
  role: ConversationMessage['role'],
  content: string,
  extras: Partial<ConversationMessage> = {},
): ConversationMessage => ({
  id,
  turnId,
  sessionId: 'sess-1',
  projectId: 'proj-1',
  role,
  content,
  createdAt: extras.createdAt ?? now,
  ...extras,
});

describe('conversationStore branch projection', () => {
  beforeEach(() => {
    useConversationStore.getState().reset();
  });

  it('hides sibling branch messages after upsert when branchState is active', () => {
    const branchState: ConversationBranchState = {
      sessionId: 'sess-1',
      rootBranchId: ROOT_BRANCH_ID,
      activeLeafBranchId: 'branch-v2',
      forks: [{
        forkId: 'msg-user-1',
        anchorMessageId: 'msg-user-1',
        activeBranchId: 'branch-v2',
        branches: [
          {
            branchId: ROOT_BRANCH_ID,
            parentBranchId: null,
            variantIndex: 0,
            anchorUserMessageId: 'msg-user-1',
            rootTurnId: 'turn-1',
          },
          {
            branchId: 'branch-v2',
            parentBranchId: ROOT_BRANCH_ID,
            variantIndex: 1,
            anchorUserMessageId: 'msg-user-1b',
            rootTurnId: 'turn-2',
          },
        ],
      }],
    };

    useConversationStore.getState().setConversationMessages([
      msg('msg-user-1', 'turn-1', 'user', 'v1', {
        branchId: ROOT_BRANCH_ID,
        forkId: 'msg-user-1',
        variantIndex: 0,
        createdAt: now,
      }),
      msg('msg-assistant-1', 'turn-1', 'assistant', 'a1', {
        branchId: ROOT_BRANCH_ID,
        createdAt: now + 10,
      }),
      msg('msg-user-2', 'turn-1b', 'user', 'follow v1', {
        branchId: ROOT_BRANCH_ID,
        createdAt: now + 20,
      }),
    ]);
    useConversationStore.getState().setBranchState(branchState);
    useConversationStore.getState().upsertConversationMessages([
      msg('msg-user-1b', 'turn-2', 'user', 'v2', {
        branchId: 'branch-v2',
        forkId: 'msg-user-1',
        variantIndex: 1,
        createdAt: now + 30,
      }),
      msg('msg-assistant-1b', 'turn-2', 'assistant', 'a2', {
        branchId: 'branch-v2',
        createdAt: now + 40,
      }),
    ]);

    expect(useConversationStore.getState().conversationMessages.map((entry) => entry.id)).toEqual([
      'msg-user-1b',
      'msg-assistant-1b',
    ]);
    expect(useConversationStore.getState().allConversationMessages).toHaveLength(5);
    expect(
      resolveVisibleConversationMessages(
        useConversationStore.getState().allConversationMessages,
        branchState,
      ).map((entry) => entry.id),
    ).toEqual(['msg-user-1b', 'msg-assistant-1b']);
  });

  it('applies atomic snapshot so messages and branchState cannot diverge', () => {
    const branchState: ConversationBranchState = {
      sessionId: 'sess-1',
      rootBranchId: ROOT_BRANCH_ID,
      activeLeafBranchId: 'branch-v2',
      forks: [{
        forkId: 'fork-a',
        anchorMessageId: 'u1',
        activeBranchId: 'branch-v2',
        branches: [
          {
            branchId: ROOT_BRANCH_ID,
            parentBranchId: null,
            variantIndex: 0,
            anchorUserMessageId: 'u1',
            rootTurnId: 't1',
          },
          {
            branchId: 'branch-v2',
            parentBranchId: ROOT_BRANCH_ID,
            variantIndex: 1,
            anchorUserMessageId: 'u1b',
            rootTurnId: 't2',
          },
        ],
      }],
    };
    useConversationStore.getState().setConversationSnapshot([
      msg('u1', 't1', 'user', 'old', { branchId: ROOT_BRANCH_ID, forkId: 'fork-a', createdAt: now }),
      msg('u1b', 't2', 'user', 'new', { branchId: 'branch-v2', forkId: 'fork-a', createdAt: now + 1 }),
    ], branchState);

    expect(useConversationStore.getState().conversationMessages.map((entry) => entry.id)).toEqual(['u1b']);
  });
});
