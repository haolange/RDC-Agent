import type { ConversationAttachmentInput, ConversationMessage, ConversationTurnResult } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { AgentMode } from '@shared/types/layout';
import type { AppMode, ProjectRecord, RunSummary, SessionRecord } from '@shared/types/session';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';
import type { PendingAttachmentDraft } from '../../../app/bootstrap/types';
import { useConversationStore } from '../../../stores/conversationStore';
import { useProjectStore } from '../../../stores/projectStore';

const EXECUTABLE_APP_MODES = new Set<string>(['edit', 'debugger', 'analyzer', 'optimizer']);

export const toConversationMode = (mode: AgentMode): AppMode => {
  if (mode === 'ask' || mode === 'plan') {
    return 'ask';
  }
  return EXECUTABLE_APP_MODES.has(mode) ? mode as AppMode : 'edit';
};

export const toConversationAttachmentInputs = (
  pendingAttachments: PendingAttachmentDraft[],
): ConversationAttachmentInput[] => pendingAttachments.map((attachment) => ({
  sourcePath: attachment.sourcePath,
  fileName: attachment.fileName,
  mimeType: attachment.mimeType,
  size: attachment.size,
}));

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
    refreshTasks.push(electronAPI.session.list(result.session.projectId).then((sessionsResult) => {
      setSessions(sessionsResult.sessions ?? []);
    }));
  }

  if (result.messages) {
    // Merge into the full store set so inactive branch siblings survive rewrite snapshots.
    // reconcileTurnMessages only refreshes overlapping ids; visible projection happens in the store.
    const allMessages = useConversationStore.getState().allConversationMessages;
    const reconciled = reconcileTurnMessages(allMessages, result.messages);
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
  } else {
    upsertConversationMessages([
      result.userMessage,
      result.assistantDraftMessage,
    ]);
    if (result.branchState !== undefined) {
      setBranchState(result.branchState ?? null);
    }
  }

  if (result.runUpdate) {
    setCurrentRun(result.runUpdate);
    refreshTasks.push(electronAPI.run.list(result.runUpdate.sessionId).then((runsResult) => {
      setRuns(runsResult.runs ?? []);
    }));
  }

  if (result.tracePresentation) {
    setTracePresentation(result.tracePresentation);
  }

  if (refreshTasks.length > 0) {
    void Promise.all(refreshTasks).catch((error) => {
      console.warn('[conversation] Failed to refresh turn side data.', error);
    });
  }
}

export async function syncE2EConversationState(options: {
  electronAPI: NonNullable<Window['electronAPI']>;
  sessionId: string | null | undefined;
  turnId: string;
  setConversationMessages: (messages: ConversationMessage[]) => void;
  setTracePresentation: (presentation: AgentRunPresentation | null) => void;
  setBranchState?: (branchState: ConversationBranchState | null) => void;
  shouldApply?: () => boolean;
}) {
  const {
    electronAPI,
    sessionId,
    turnId,
    setConversationMessages,
    setTracePresentation,
    setBranchState,
    shouldApply,
  } = options;

  if (typeof navigator === 'undefined' || !navigator.webdriver || !sessionId) {
    return;
  }

  const maxAttempts = 40;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const historyResult = await electronAPI.conversation.getHistory(sessionId).catch(() => ({ messages: [] }));
    const history = historyResult.messages ?? [];
    const assistantForTurn = history.find((message) => message.turnId === turnId && message.role === 'assistant');
    const done = assistantForTurn && ['complete', 'error', 'stopped'].includes(assistantForTurn.status ?? 'draft');
    if (done) {
      if (shouldApply && !shouldApply()) {
        return;
      }
      setConversationMessages(history);
      if (setBranchState && 'branchState' in historyResult) {
        setBranchState(historyResult.branchState ?? null);
      }
      const workflowPresentation = await electronAPI.trace.getProjection(sessionId).catch(() => null);
      if (workflowPresentation?.presentation) {
        setTracePresentation(workflowPresentation.presentation);
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
