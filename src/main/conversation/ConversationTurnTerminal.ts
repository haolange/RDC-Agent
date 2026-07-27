import { normalizeBranchId } from './ConversationBranchResolver';
import { ROOT_BRANCH_ID } from '@shared/types/conversationBranch';
import type { ConversationMessage, ConversationStreamEvent } from '@shared/types/conversation';
import { storageAdapter } from '../sessions/StorageAdapter';
import { workflowProjectionPublisher } from '../workflow/debugger/WorkflowProjectionPublisher';
import { traceService } from '../agent-trace/TraceService';

export function persistConversationSnapshot(
    sessionId: string | null | undefined,
    message: ConversationMessage,
  ): Error | null {
    if (!sessionId) {
      return null;
    }
    try {
      storageAdapter.appendConversationMessage(sessionId, message);
      return null;
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (/^Session not found for conversation history:/i.test(normalized.message)) {
        console.info(`[ConversationService] Ignored conversation write after session teardown for ${sessionId}.`);
        return null;
      }
      console.error(`[ConversationService] Failed to persist conversation snapshot for ${sessionId}:`, normalized);
      return normalized;
    }
  }

export function assertTerminalContextOwnership(
    sessionId: string,
    turnId: string,
    userMessageId: string,
    assistantMessageId: string,
    branchId: string,
  ): void {
    const history = storageAdapter.readConversationHistory(sessionId);
    const user = history.find((message) => message.id === userMessageId);
    const assistant = history.find((message) => message.id === assistantMessageId);
    const normalizedBranchId = normalizeBranchId(branchId);
    if (
      !user
      || user.role !== 'user'
      || user.turnId !== turnId
      || normalizeBranchId(user.branchId) !== normalizedBranchId
      || !assistant
      || assistant.role !== 'assistant'
      || assistant.turnId !== turnId
      || normalizeBranchId(assistant.branchId) !== normalizedBranchId
    ) {
      throw new Error(`Conversation message ownership changed before context journal append for turn ${turnId}.`);
    }
    if (normalizedBranchId === ROOT_BRANCH_ID) return;
    const branchState = storageAdapter.readConversationBranchState(sessionId);
    const concreteBranch = branchState?.forks
      .flatMap((fork) => fork.branches)
      .find((branch) => branch.branchId === normalizedBranchId);
    if (
      !concreteBranch
      || concreteBranch.anchorUserMessageId !== userMessageId
      || concreteBranch.rootTurnId !== turnId
    ) {
      throw new Error(`Conversation branch ownership changed before context journal append for turn ${turnId}.`);
    }
  }

export function emitConversationEvent(event: ConversationStreamEvent) {
    workflowProjectionPublisher.publishConversationEvent(event);
  }

export function publishTraceProjection(sessionId: string | null | undefined): void {
    if (!sessionId) {
      return;
    }

    void traceService.getSession(sessionId)
      .then((result) => {
        if (result.success && result.presentation) {
          workflowProjectionPublisher.publishTraceProjectionChanged({ projectId: result.presentation.projectId, sessionId: result.presentation.sessionId }, result.presentation);
        }
      })
      .catch((error) => {
        console.error('[ConversationService] Failed to publish trace projection:', error);
      });
  }

export function publishConversationTrace(
    traceSessionId: string,
    messages: ConversationMessage[],
    persistedSessionId?: string | null,
    publishProjection: typeof publishTraceProjection = publishTraceProjection,
  ): void {
    if (persistedSessionId) {
      publishProjection(persistedSessionId);
      return;
    }

    void traceService.buildConversationPresentation(traceSessionId, messages)
      .then((presentation) => {
        workflowProjectionPublisher.publishTraceProjectionChanged({ projectId: presentation.projectId, sessionId: presentation.sessionId }, presentation);
      });
  }

export function ephemeralTraceSessionId(turnId: string): string {
    return `conversation-${turnId}`;
  }
