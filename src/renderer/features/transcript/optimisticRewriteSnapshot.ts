import { ROOT_BRANCH_ID } from '@shared/types/conversationBranch';
import { createDefaultBranchState, normalizeBranchId } from '@shared/conversation/conversationBranchResolver';
import { conversationTurnIds } from '@shared/conversation/conversationTurnIds';
import type { ConversationMessage } from '@shared/types/conversation';
import type { AgentRole } from '@shared/types/agent';
import type { ConversationBranchState } from '@shared/types/conversationBranch';

/**
 * The branch, user and assistant messages an edit-and-resend shows before main answers, under the ids main gives them
 * (`conversationTurnIds`): main's answer updates them in place.
 */
export function buildOptimisticRewriteSnapshot(input: {
  requestId: string;
  sourceMessage: ConversationMessage;
  nextContent: string;
  allMessages: ConversationMessage[];
  branchState: ConversationBranchState | null;
  agentId?: AgentRole | null;
}): {
  messages: ConversationMessage[];
  branchState: ConversationBranchState;
} {
  const { requestId, sourceMessage, nextContent, allMessages, branchState, agentId } = input;
  const now = Date.now();
  const sessionId = sourceMessage.sessionId ?? '';
  const {
    turnId: optimisticTurnId,
    branchId: optimisticBranchId,
    userMessageId: optimisticUserId,
    assistantMessageId: optimisticAssistantId,
  } = conversationTurnIds(requestId);
  const parentBranchId = normalizeBranchId(sourceMessage.branchId);
  const forkId = sourceMessage.forkId ?? sourceMessage.id;

  const baseState = branchState ? structuredClone(branchState) : createDefaultBranchState(sessionId);
  if (!baseState.sessionId && sessionId) {
    baseState.sessionId = sessionId;
  }

  let fork = baseState.forks.find((entry) => entry.forkId === forkId);
  if (!fork) {
    fork = {
      forkId,
      anchorMessageId: sourceMessage.id,
      activeBranchId: parentBranchId,
      branches: [
        {
          branchId: parentBranchId === ROOT_BRANCH_ID ? ROOT_BRANCH_ID : parentBranchId,
          parentBranchId: parentBranchId === ROOT_BRANCH_ID ? null : null,
          variantIndex: sourceMessage.variantIndex ?? 0,
          anchorUserMessageId: sourceMessage.id,
          rootTurnId: sourceMessage.turnId,
        },
      ],
    };
    baseState.forks.push(fork);
  }

  const variantIndex = fork.branches.length;
  fork.branches.push({
    branchId: optimisticBranchId,
    parentBranchId,
    variantIndex,
    anchorUserMessageId: optimisticUserId,
    rootTurnId: optimisticTurnId,
  });
  fork.activeBranchId = optimisticBranchId;
  baseState.activeLeafBranchId = optimisticBranchId;

  const userMessage: ConversationMessage = {
    id: optimisticUserId,
    requestId,
    turnId: optimisticTurnId,
    sessionId: sourceMessage.sessionId,
    projectId: sourceMessage.projectId,
    runId: sourceMessage.runId ?? null,
    profileId: sourceMessage.profileId,
    role: 'user',
    content: nextContent,
    status: 'complete',
    branchId: optimisticBranchId,
    forkId,
    variantIndex,
    attachments: sourceMessage.attachments,
    createdAt: now,
    updatedAt: now,
    workTrace: null,
  };

  const assistantDraftMessage: ConversationMessage = {
    id: optimisticAssistantId,
    requestId,
    turnId: optimisticTurnId,
    sessionId: sourceMessage.sessionId,
    projectId: sourceMessage.projectId,
    runId: sourceMessage.runId ?? null,
    profileId: sourceMessage.profileId,
    role: 'assistant',
    agentId: agentId ?? undefined,
    content: '',
    status: 'streaming',
    branchId: optimisticBranchId,
    forkId,
    variantIndex,
    createdAt: now,
    updatedAt: now,
    workTrace: {
      status: 'running',
      summary: '',
      blocks: [],
      updatedAt: now,
    },
  };

  return {
    messages: [...allMessages, userMessage, assistantDraftMessage],
    branchState: baseState,
  };
}
