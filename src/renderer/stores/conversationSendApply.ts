import type { ConversationMessage, ConversationTurnResult } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { ProjectRecord, RunSummary, SessionRecord } from '@shared/types/session';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';
import { useConversationStore } from './conversationStore';
import { useProjectStore } from './projectStore';
import { stopWorkTrace } from '../lib/stopWorkTrace';
import { getActiveSessionId, isActiveSessionEvent } from './sessionEventGate';
import { useSessionProjectionStore } from './sessionProjectionStore';

/**
 * Turn 响应里的消息以“可见分支成员集”为准，但流事件（SSE/IPC）可能先于
 * invoke 响应送达终态 patch；对账时按 updatedAt 保留 store 中更新的版本，
 * 避免把已完成的 assistant 消息覆盖回 streaming draft。
 */
const reconcileTurnMessages = (
  currentMessages: ConversationMessage[],
  turnMessages: ConversationMessage[],
): ConversationMessage[] => {
  const currentById = new Map(currentMessages.map((message) => [message.id, message]));
  return turnMessages.map((message) => {
    const existing = currentById.get(message.id);
    if (!existing) {
      return message;
    }
    const existingUpdatedAt = existing.updatedAt ?? existing.createdAt;
    const nextUpdatedAt = message.updatedAt ?? message.createdAt;
    return existingUpdatedAt > nextUpdatedAt ? existing : message;
  });
};

export async function applyConversationTurnResult(options: {
  electronAPI: NonNullable<Window['electronAPI']>;
  result: ConversationTurnResult;
  currentProject: ProjectRecord | null;
  setCurrentSession: (session: SessionRecord | null) => void;
  setSessions: (sessions: SessionRecord[]) => void;
  setCurrentRun: (run: RunSummary | null) => void;
  setRuns: (runs: RunSummary[]) => void;
  setTracePresentation: (presentation: AgentRunPresentation | null) => void;
  setConversationMessages: (messages: ConversationMessage[]) => void;
  setBranchState: (branchState: ConversationBranchState | null) => void;
  setConversationSnapshot?: (
    messages: ConversationMessage[],
    branchState?: ConversationBranchState | null,
  ) => void;
  upsertConversationMessages: (messages: ConversationMessage[]) => void;
}) {
  const {
    electronAPI,
    result,
    currentProject,
    setCurrentSession,
    setSessions,
    setCurrentRun,
    setRuns,
    setTracePresentation,
    setConversationMessages,
    setBranchState,
    setConversationSnapshot,
    upsertConversationMessages,
  } = options;
  const refreshTasks: Array<Promise<void>> = [];
  const requestId = result.userMessage.requestId
    ?? result.assistantDraftMessage.requestId
    ?? null;
  const turnSessionId = result.session?.sessionId
    ?? result.userMessage.sessionId
    ?? result.assistantDraftMessage.sessionId
    ?? null;
  const conversationState = useConversationStore.getState();

  // Preparing revoke already cleaned UI; do not re-apply streaming turn.
  if (requestId && conversationState.revokedRequestIds.includes(requestId)) {
    conversationState.consumeRevokedRequest(requestId);
    return;
  }

  const requestStopped = Boolean(
    requestId && conversationState.monotonicStoppedRequestIds.includes(requestId),
  );

  const forceStoppedMessages = (messages: ConversationMessage[]): ConversationMessage[] => {
    if (!requestStopped) return messages;
    return messages.map((message) => (
      message.role === 'assistant'
        && (message.status === 'draft' || message.status === 'streaming')
        ? stopWorkTrace(message)
        : message
    ));
  };

  // Background session: never mutate active project/session selection or UI stores.
  // With no active session (for example the synchronous handoff after a new-session
  // creation), the result remains the only visible result and must be applied.
  const activeSessionId = getActiveSessionId();
  if (turnSessionId && activeSessionId && !isActiveSessionEvent(turnSessionId)) {
    for (const message of forceStoppedMessages(result.messages ?? [
      result.userMessage,
      result.assistantDraftMessage,
    ])) {
      useSessionProjectionStore.getState().projectConversationMessage(turnSessionId, message);
    }
    if (result.tracePresentation) {
      useSessionProjectionStore.getState().projectTrace(turnSessionId, result.tracePresentation);
    }
    return;
  }

  if (result.session?.projectId && currentProject?.projectId !== result.session.projectId) {
    refreshTasks.push(electronAPI.project.list().then((projectsResult) => {
      const nextProjects = projectsResult.projects ?? [];
      useProjectStore.getState().setProjects(nextProjects);
      const matchedProject = nextProjects.find((project) => project.projectId === result.session?.projectId) ?? null;
      useProjectStore.getState().setCurrentProject(matchedProject);
    }));
  }

  if (result.session?.sessionId) {
    setCurrentSession(result.session);
    // A composer turn can create the first session while the project rail is selected.
    // The authoritative result now owns a session, so the rail must immediately show
    // the session inspector instead of leaving the project import surface visible.
    useProjectStore.getState().setRightRailTarget('session');
    refreshTasks.push(electronAPI.session.list(result.session.projectId).then((sessionsResult) => {
      setSessions(sessionsResult.sessions ?? []);
    }));
  }

  if (result.messages) {
    // Merge into the full store set so inactive branch siblings survive rewrite snapshots.
    // reconcileTurnMessages only refreshes overlapping ids; visible projection happens in the store.
    const allMessages = useConversationStore.getState().allConversationMessages;
    const reconciled = forceStoppedMessages(reconcileTurnMessages(allMessages, result.messages));
    const reconciledIds = new Set(reconciled.map((message) => message.id));
    const merged = [
      ...allMessages.filter((message) => !reconciledIds.has(message.id)),
      ...reconciled,
    ];
    // Atomically align messages + branchState so upsert races cannot leak sibling branches.
    if (setConversationSnapshot && result.branchState !== undefined) {
      setConversationSnapshot(merged, result.branchState ?? null);
    } else {
      setConversationMessages(merged);
      if (result.branchState !== undefined) {
        setBranchState(result.branchState ?? null);
      }
    }
    if (requestStopped && requestId) {
      const realTurnId = result.assistantDraftMessage.turnId || result.userMessage.turnId;
      const optimisticTurnId = `optimistic-turn-${requestId}`;
      useConversationStore.getState().migrateMonotonicStoppedTurn(optimisticTurnId, realTurnId);
      useConversationStore.getState().markTurnMonotonicallyStopped(realTurnId);
      useConversationStore.getState().markRequestMonotonicallyStopped(requestId);
    }
  } else {
    upsertConversationMessages(forceStoppedMessages([
      result.userMessage,
      result.assistantDraftMessage,
    ]));
    if (result.branchState !== undefined) {
      setBranchState(result.branchState ?? null);
    }
  }

  if (result.runUpdate && isActiveSessionEvent(result.runUpdate.sessionId)) {
    setCurrentRun(result.runUpdate);
    refreshTasks.push(electronAPI.run.list(result.runUpdate.sessionId).then((runsResult) => {
      setRuns(runsResult.runs ?? []);
    }));
  }

  if (result.tracePresentation) {
    if (turnSessionId && !isActiveSessionEvent(turnSessionId)) {
      useSessionProjectionStore.getState().projectTrace(turnSessionId, result.tracePresentation);
    } else {
      setTracePresentation(result.tracePresentation);
    }
  }

  if (refreshTasks.length > 0) {
    void Promise.all(refreshTasks).catch((error) => {
      console.warn('[conversation] Failed to refresh turn side data.', error);
    });
  }
}

