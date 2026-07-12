import { describe, expect, it } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import { ROOT_BRANCH_ID } from '@shared/types/conversationBranch';
import {
  compareConversationMessages,
  findForkForVisibleUserMessage,
  getConcreteForkBranches,
  shouldShowForkNavigatorForMessage,
} from './conversationBranchResolver';

const msg = (
  id: string,
  role: ConversationMessage['role'],
  extras: Partial<ConversationMessage> = {},
): ConversationMessage => ({
  id,
  turnId: extras.turnId ?? `turn-${id}`,
  sessionId: 'sess-1',
  projectId: 'proj-1',
  role,
  content: extras.content ?? id,
  createdAt: extras.createdAt ?? 1,
  ...extras,
});

describe('conversation message ordering', () => {
  it('keeps the user before the assistant when same-turn timestamps collide', () => {
    const user = msg('user', 'user', { turnId: 'turn-1', createdAt: 10, updatedAt: 30 });
    const assistant = msg('assistant', 'assistant', { turnId: 'turn-1', createdAt: 10, updatedAt: 20 });
    expect([assistant, user].sort(compareConversationMessages).map((message) => message.role))
      .toEqual(['user', 'assistant']);
  });
});

describe('conversationBranchResolver navigator isolation', () => {
  it('only shows navigator on the active variant anchor and never cross-matches forks', () => {
    const branchState: ConversationBranchState = {
      sessionId: 'sess-1',
      rootBranchId: ROOT_BRANCH_ID,
      activeLeafBranchId: 'branch-b',
      forks: [
        {
          forkId: 'fork-early',
          anchorMessageId: 'early-u1',
          activeBranchId: 'branch-early-2',
          branches: [
            {
              branchId: ROOT_BRANCH_ID,
              parentBranchId: null,
              variantIndex: 0,
              anchorUserMessageId: 'early-u1',
              rootTurnId: 'te1',
            },
            {
              branchId: 'branch-early-2',
              parentBranchId: ROOT_BRANCH_ID,
              variantIndex: 1,
              anchorUserMessageId: 'early-u2',
              rootTurnId: 'te2',
            },
            {
              branchId: 'branch-early-3',
              parentBranchId: ROOT_BRANCH_ID,
              variantIndex: 2,
              anchorUserMessageId: 'early-u3',
              rootTurnId: 'te3',
            },
            {
              branchId: 'branch-early-4',
              parentBranchId: ROOT_BRANCH_ID,
              variantIndex: 3,
              anchorUserMessageId: 'early-u4',
              rootTurnId: 'te4',
            },
          ],
        },
        {
          forkId: 'fork-late',
          anchorMessageId: 'late-u1',
          activeBranchId: 'branch-b',
          branches: [
            {
              branchId: ROOT_BRANCH_ID,
              parentBranchId: null,
              variantIndex: 0,
              anchorUserMessageId: 'late-u1',
              rootTurnId: 'tl1',
            },
            {
              branchId: 'branch-b',
              parentBranchId: ROOT_BRANCH_ID,
              variantIndex: 1,
              anchorUserMessageId: 'late-u2',
              rootTurnId: 'tl2',
            },
          ],
        },
      ],
    };

    const lateActive = msg('late-u2', 'user', { forkId: 'fork-late', branchId: 'branch-b' });
    const lateInactive = msg('late-u1', 'user', { forkId: 'fork-late', branchId: ROOT_BRANCH_ID });
    const earlyActive = msg('early-u4', 'user', { forkId: 'fork-early', branchId: 'branch-early-4' });

    expect(shouldShowForkNavigatorForMessage(branchState, lateActive)).toBe(true);
    expect(shouldShowForkNavigatorForMessage(branchState, lateInactive)).toBe(false);
    expect(shouldShowForkNavigatorForMessage(branchState, earlyActive)).toBe(false);
    expect(findForkForVisibleUserMessage(branchState, lateActive)?.forkId).toBe('fork-late');
    expect(getConcreteForkBranches(findForkForVisibleUserMessage(branchState, lateActive)!)).toHaveLength(2);
  });

  it('excludes empty pending branch shells from navigator totals', () => {
    const fork = {
      forkId: 'fork-1',
      anchorMessageId: 'u1',
      activeBranchId: 'branch-new',
      branches: [
        {
          branchId: ROOT_BRANCH_ID,
          parentBranchId: null,
          variantIndex: 0,
          anchorUserMessageId: 'u1',
          rootTurnId: 't1',
        },
        {
          branchId: 'branch-new',
          parentBranchId: ROOT_BRANCH_ID,
          variantIndex: 1,
          anchorUserMessageId: '',
          rootTurnId: '',
        },
      ],
    };
    expect(getConcreteForkBranches(fork)).toHaveLength(1);
  });
});
