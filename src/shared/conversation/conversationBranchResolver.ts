import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranch, ConversationBranchState, ConversationFork } from '@shared/types/conversationBranch';
import { ROOT_BRANCH_ID } from '@shared/types/conversationBranch';

const sortByCreatedAt = (left: ConversationMessage, right: ConversationMessage): number => {
  if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
  const leftUpdated = left.updatedAt ?? left.createdAt;
  const rightUpdated = right.updatedAt ?? right.createdAt;
  return leftUpdated - rightUpdated;
};

export function createDefaultBranchState(sessionId: string): ConversationBranchState {
  return {
    sessionId,
    rootBranchId: ROOT_BRANCH_ID,
    activeLeafBranchId: ROOT_BRANCH_ID,
    forks: [],
  };
}

export function normalizeBranchId(branchId?: string | null): string {
  return branchId?.trim() || ROOT_BRANCH_ID;
}

export function repairConversationBranchState(
  allMessages: ConversationMessage[],
  branchState: ConversationBranchState | null,
): { branchState: ConversationBranchState | null; repaired: boolean } {
  if (!branchState || branchState.forks.length === 0) {
    return { branchState, repaired: false };
  }

  let repaired = false;
  const forks = branchState.forks.map((fork) => {
    let forkRepaired = false;
    const branches = fork.branches.map((branch) => {
      if (branch.anchorUserMessageId && branch.rootTurnId) {
        return branch;
      }
      const anchor = findRecoverableBranchAnchor(allMessages, fork, branch);
      if (!anchor) {
        return branch;
      }
      repaired = true;
      forkRepaired = true;
      return {
        ...branch,
        anchorUserMessageId: branch.anchorUserMessageId || anchor.id,
        rootTurnId: branch.rootTurnId || anchor.turnId,
      };
    });
    return forkRepaired ? { ...fork, branches } : fork;
  });

  return repaired
    ? { branchState: { ...branchState, forks }, repaired: true }
    : { branchState, repaired: false };
}

function findRecoverableBranchAnchor(
  allMessages: ConversationMessage[],
  fork: ConversationFork,
  branch: ConversationBranch,
): ConversationMessage | null {
  const branchId = normalizeBranchId(branch.branchId);
  const candidates = allMessages
    .filter((message) => (
      message.role === 'user'
      && normalizeBranchId(message.branchId) === branchId
    ))
    .sort(sortByCreatedAt);

  return candidates.find((message) => (
    message.forkId === fork.forkId
    && message.variantIndex === branch.variantIndex
  ))
    ?? candidates.find((message) => message.forkId === fork.forkId)
    ?? candidates[0]
    ?? null;
}

/**
 * 沿 active fork 选择递归拼接可见消息路径（完整对话树）。
 */
export function resolveVisibleConversationMessages(
  allMessages: ConversationMessage[],
  branchState: ConversationBranchState | null,
): ConversationMessage[] {
  if (!branchState || branchState.forks.length === 0) {
    return allMessages
      .filter((message) => normalizeBranchId(message.branchId) === ROOT_BRANCH_ID)
      .sort(sortByCreatedAt);
  }

  return collectBranchPath(
    branchState.rootBranchId,
    allMessages,
    branchState.forks,
    0,
  );
}

function collectBranchPath(
  branchId: string,
  allMessages: ConversationMessage[],
  forks: ConversationFork[],
  minCreatedAt: number,
): ConversationMessage[] {
  const branchMessages = allMessages
    .filter((message) => normalizeBranchId(message.branchId) === branchId && message.createdAt > minCreatedAt)
    .sort(sortByCreatedAt);

  const forkCandidates = forks
    .map((fork) => {
      const anchor = allMessages.find((message) => message.id === fork.anchorMessageId);
      if (!anchor || normalizeBranchId(anchor.branchId) !== branchId) return null;
      if (anchor.createdAt <= minCreatedAt) return null;
      return { fork, anchor };
    })
    .filter((entry): entry is { fork: ConversationFork; anchor: ConversationMessage } => entry !== null)
    .sort((left, right) => left.anchor.createdAt - right.anchor.createdAt);

  const nextFork = forkCandidates[0];
  if (!nextFork) {
    return branchMessages;
  }

  const { fork, anchor } = nextFork;
  const beforeFork = branchMessages.filter((message) => message.createdAt < anchor.createdAt);
  const activeBranch = fork.branches.find((entry) => entry.branchId === fork.activeBranchId);
  if (!activeBranch) {
    return beforeFork;
  }

  const activeAnchor = allMessages.find((message) => message.id === activeBranch.anchorUserMessageId);
  if (!activeAnchor) {
    return beforeFork;
  }

  const turnMessages = allMessages
    .filter((message) => (
      message.turnId === activeAnchor.turnId
      && normalizeBranchId(message.branchId) === activeBranch.branchId
    ))
    .sort(sortByCreatedAt);

  if (turnMessages.length === 0) {
    return beforeFork;
  }

  const turnEnd = Math.max(...turnMessages.map((message) => message.updatedAt ?? message.createdAt));
  const suffix = collectBranchPath(activeBranch.branchId, allMessages, forks, turnEnd);
  return [...beforeFork, ...turnMessages, ...suffix];
}

export function findForkForMessage(
  branchState: ConversationBranchState,
  messageId: string,
): ConversationFork | null {
  return branchState.forks.find((fork) => (
    fork.anchorMessageId === messageId
    || fork.branches.some((branch) => branch.anchorUserMessageId === messageId)
  )) ?? null;
}

/** Branches that already have a concrete user anchor (exclude empty pending shells). */
export function getConcreteForkBranches(fork: ConversationFork): ConversationBranch[] {
  return fork.branches.filter((branch) => Boolean(branch.anchorUserMessageId?.trim()));
}

/**
 * Resolve the fork for a visible user message without cross-fork matching.
 * Prefer exact forkId; fall back to being an anchor of that fork only.
 */
export function findForkForVisibleUserMessage(
  branchState: ConversationBranchState,
  message: Pick<ConversationMessage, 'id' | 'forkId' | 'role'>,
): ConversationFork | null {
  if (message.role !== 'user') return null;
  if (message.forkId) {
    return branchState.forks.find((fork) => fork.forkId === message.forkId) ?? null;
  }
  return branchState.forks.find((fork) => (
    fork.anchorMessageId === message.id
    || fork.branches.some((branch) => branch.anchorUserMessageId === message.id)
  )) ?? null;
}

export function getForkNavigator(
  branchState: ConversationBranchState,
  forkId: string,
): { variantIndex: number; variantCount: number; canPrev: boolean; canNext: boolean } | null {
  const fork = branchState.forks.find((entry) => entry.forkId === forkId);
  if (!fork) return null;
  const concreteBranches = getConcreteForkBranches(fork);
  if (concreteBranches.length <= 1) return null;
  const activeIndex = concreteBranches.findIndex((branch) => branch.branchId === fork.activeBranchId);
  const variantIndex = activeIndex >= 0 ? activeIndex : 0;
  return {
    variantIndex,
    variantCount: concreteBranches.length,
    canPrev: variantIndex > 0,
    canNext: variantIndex < concreteBranches.length - 1,
  };
}

/**
 * Only show the navigator on the currently visible fork-anchor user message
 * (the active variant's user bubble), never on unrelated prompts.
 */
export function shouldShowForkNavigatorForMessage(
  branchState: ConversationBranchState | null,
  message: Pick<ConversationMessage, 'id' | 'forkId' | 'role'>,
): boolean {
  if (!branchState || message.role !== 'user') return false;
  const fork = findForkForVisibleUserMessage(branchState, message);
  if (!fork) return false;
  const concreteBranches = getConcreteForkBranches(fork);
  if (concreteBranches.length <= 1) return false;
  const activeBranch = concreteBranches.find((branch) => branch.branchId === fork.activeBranchId)
    ?? fork.branches.find((branch) => branch.branchId === fork.activeBranchId);
  if (!activeBranch?.anchorUserMessageId) return false;
  return activeBranch.anchorUserMessageId === message.id;
}
