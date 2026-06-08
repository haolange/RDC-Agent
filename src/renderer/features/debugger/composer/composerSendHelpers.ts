import type { ConversationAttachmentInput, ConversationMessage, ConversationTurnResult } from '@shared/types/conversation';
import type { AgentMode } from '@shared/types/layout';
import type { ProjectRecord, RunSummary, SessionRecord } from '@shared/types/session';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';
import type { AskUserPrompt, DebugPlan } from '@shared/types/workflow';
import type { PendingAttachmentDraft } from '../../../app/bootstrap/types';
import { useProjectStore } from '../../../stores/projectStore';

export function buildLocalConversationErrorTurn(options: {
  trimmed: string;
  currentMode: AgentMode;
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
  currentRun: RunSummary | null;
  pendingAttachments: PendingAttachmentDraft[];
  errorMessage: string;
  failedSummary: string;
}): ConversationMessage[] {
  const {
    trimmed,
    currentMode,
    currentProject,
    currentSession,
    currentRun,
    pendingAttachments,
    errorMessage,
    failedSummary,
  } = options;
  const turnId = `local-turn-${Date.now()}`;
  const now = Date.now();

  return [
    {
      id: `local-user-${now}`,
      turnId,
      sessionId: currentSession?.sessionId ?? null,
      projectId: currentProject?.projectId ?? null,
      runId: currentRun?.runId ?? null,
      modeContext: currentMode,
      role: 'user',
      content: trimmed,
      status: 'complete',
      updatedAt: now,
      reasoningTrace: null,
      attachments: pendingAttachments.map((attachment) => ({
        attachmentId: `local-${attachment.id}`,
        sessionId: currentSession?.sessionId ?? '',
        projectId: currentProject?.projectId ?? '',
        kind: attachment.kind,
        fileName: attachment.fileName,
        filePath: attachment.sourcePath,
        mimeType: attachment.mimeType || 'application/octet-stream',
        size: attachment.size || 0,
        createdAt: now,
      })),
      createdAt: now,
    },
    {
      id: `local-assistant-${now + 1}`,
      turnId,
      sessionId: currentSession?.sessionId ?? null,
      projectId: currentProject?.projectId ?? null,
      runId: currentRun?.runId ?? null,
      modeContext: currentMode,
      role: 'assistant',
      agentId: 'rdc-debugger',
      content: errorMessage,
      status: 'error',
      updatedAt: now,
      reasoningTrace: {
        status: 'error',
        summary: failedSummary,
        steps: [],
        updatedAt: now,
      },
      createdAt: now,
    },
  ];
}

export const toConversationAttachmentInputs = (
  pendingAttachments: PendingAttachmentDraft[],
): ConversationAttachmentInput[] => pendingAttachments.map((attachment) => ({
  sourcePath: attachment.sourcePath,
  fileName: attachment.fileName,
  mimeType: attachment.mimeType,
  size: attachment.size,
}));

export async function applyConversationTurnResult(options: {
  electronAPI: NonNullable<Window['electronAPI']>;
  result: ConversationTurnResult;
  currentProject: ProjectRecord | null;
  setCurrentSession: (session: SessionRecord | null) => void;
  setSessions: (sessions: SessionRecord[]) => void;
  setCurrentRun: (run: RunSummary | null) => void;
  setRuns: (runs: RunSummary[]) => void;
  setCurrentDebugPlan: (debugPlan: DebugPlan | null) => void;
  setPendingQuestions: (prompt: AskUserPrompt | null) => void;
  setTracePresentation: (presentation: AgentRunPresentation | null) => void;
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
    setCurrentDebugPlan,
    setPendingQuestions,
    setTracePresentation,
    upsertConversationMessages,
  } = options;

  if (result.session?.projectId && currentProject?.projectId !== result.session.projectId) {
    const projectsResult = await electronAPI.project.list();
    const nextProjects = projectsResult.projects ?? [];
    useProjectStore.getState().setProjects(nextProjects);
    const matchedProject = nextProjects.find((project) => project.projectId === result.session?.projectId) ?? null;
    useProjectStore.getState().setCurrentProject(matchedProject);
  }

  if (result.session?.sessionId) {
    setCurrentSession(result.session);
    const sessionsResult = await electronAPI.session.list(result.session.projectId);
    setSessions(sessionsResult.sessions ?? []);
  }

  upsertConversationMessages([
    result.userMessage,
    result.assistantDraftMessage,
  ]);

  if (result.runUpdate) {
    setCurrentRun(result.runUpdate);
    const runsResult = await electronAPI.run.list(result.runUpdate.sessionId);
    setRuns(runsResult.runs ?? []);
  }

  setCurrentDebugPlan(result.debugPlanSummary ?? null);
  setPendingQuestions(result.pendingQuestions ?? null);
  if (result.tracePresentation) {
    setTracePresentation(result.tracePresentation);
  }
}

export async function syncE2EConversationState(options: {
  electronAPI: NonNullable<Window['electronAPI']>;
  sessionId: string | null | undefined;
  turnId: string;
  setConversationMessages: (messages: ConversationMessage[]) => void;
  setTracePresentation: (presentation: AgentRunPresentation | null) => void;
}) {
  const {
    electronAPI,
    sessionId,
    turnId,
    setConversationMessages,
    setTracePresentation,
  } = options;

  if (!navigator.webdriver || !sessionId) {
    return;
  }

  const maxAttempts = 40;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const historyResult = await electronAPI.conversation.getHistory(sessionId).catch(() => ({ messages: [] }));
    const history = historyResult.messages ?? [];
    const assistantForTurn = history.find((message) => message.turnId === turnId && message.role === 'assistant');
    const done = assistantForTurn && ['complete', 'error', 'stopped'].includes(assistantForTurn.status ?? 'draft');
    if (done) {
      setConversationMessages(history);
      const workflowPresentation = await electronAPI.trace.getProjection(sessionId).catch(() => null);
      if (workflowPresentation?.presentation) {
        setTracePresentation(workflowPresentation.presentation);
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}


