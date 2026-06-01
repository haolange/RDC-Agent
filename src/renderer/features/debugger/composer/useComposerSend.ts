import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import type { ConversationAttachmentInput } from '@shared/types/conversation';
import type { AgentMode } from '@shared/types/layout';
import type { ProjectRecord, RunSummary, SessionRecord } from '@shared/types/session';
import { useConversationStore } from '../../../stores/conversationStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';
import { useWorkflowStore } from '../../../stores/workflowStore';
import type { useI18n } from '../../../i18n';
import type { PendingAttachmentDraft } from '../../../app/bootstrap/types';
import { buildLocalConversationErrorTurn } from './composerSendHelpers';
import { useComposerStop } from './useComposerStop';

type Translate = ReturnType<typeof useI18n>['t'];

export function useComposerSend(options: {
  showNotice: (message: string) => void;
  t: Translate;
  currentMode: AgentMode;
  setCurrentMode: (mode: AgentMode) => void;
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
  currentRun: RunSummary | null;
  selectedDeviceEntry: { id: string } | undefined;
  hasOpenedCaptureForCurrentProject: boolean;
  openCaptureRequiredLabel: string;
  hasActiveDebugRun: boolean;
  hasActiveConversationTurn: boolean;
  promptValue: string;
  setPromptValue: (value: string) => void;
  pendingAttachments: PendingAttachmentDraft[];
  setPendingAttachments: Dispatch<SetStateAction<PendingAttachmentDraft[]>>;
}) {
  const {
    showNotice,
    t,
    currentMode,
    setCurrentMode,
    currentProject,
    currentSession,
    currentRun,
    selectedDeviceEntry,
    hasOpenedCaptureForCurrentProject,
    openCaptureRequiredLabel,
    hasActiveDebugRun,
    hasActiveConversationTurn,
    promptValue,
    setPromptValue,
    pendingAttachments,
    setPendingAttachments,
  } = options;

  const [isPromptSending, setIsPromptSending] = useState(false);

  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);
  const setSessions = useProjectStore((state) => state.setSessions);
  const setCurrentSession = useProjectStore((state) => state.setCurrentSession);
  const setRuns = useSessionStore((state) => state.setRuns);
  const setCurrentDebugPlan = useWorkflowStore((state) => state.setCurrentDebugPlan);
  const setPendingQuestions = useWorkflowStore((state) => state.setPendingQuestions);
  const setWorkstreamPresentation = useWorkflowStore((state) => state.setWorkstreamPresentation);
  const setConversationMessages = useConversationStore((state) => state.setConversationMessages);
  const upsertConversationMessages = useConversationStore((state) => state.upsertConversationMessages);

  const { handlePrimaryStop } = useComposerStop({
    showNotice,
    t,
    currentSession,
    currentRun,
    setIsPromptSending,
  });

  const isComposerBusy = isPromptSending || hasActiveConversationTurn || hasActiveDebugRun;

  const syncE2EConversationState = useCallback(async (
    electronAPI: NonNullable<typeof window.electronAPI>,
    sessionId: string | null | undefined,
    turnId: string,
  ) => {
    if (!navigator.webdriver || !sessionId) {
      return;
    }

    const maxAttempts = 40;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const historyResult = await electronAPI.conversation.getHistory(sessionId).catch(() => ({ messages: [] as typeof useConversationStore.getState extends () => infer T ? T extends { conversationMessages: infer M } ? M : never : never }));
      const history = historyResult.messages ?? [];
      const assistantForTurn = history.find((message) => message.turnId === turnId && message.role === 'assistant');
      const done = assistantForTurn && ['complete', 'error', 'stopped'].includes(assistantForTurn.status ?? 'draft');
      if (done) {
        setConversationMessages(history);
        const workflowPresentation = await electronAPI.workflow.getWorkstreamSession(sessionId).catch(() => null);
        if (workflowPresentation?.presentation) {
          setWorkstreamPresentation(workflowPresentation.presentation);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }, [setConversationMessages, setWorkstreamPresentation]);

  const handlePromptSend = useCallback(async () => {
    const trimmed = promptValue.trim();
    if ((!trimmed && pendingAttachments.length === 0) || isComposerBusy) {
      return;
    }

    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    if (currentMode !== 'ask' && !hasOpenedCaptureForCurrentProject) {
      showNotice(openCaptureRequiredLabel);
      setCurrentMode('ask');
      return;
    }

    setIsPromptSending(true);
    try {
      const result = await electronAPI.conversation.sendMessage({
        projectId: currentProject?.projectId ?? null,
        sessionId: currentSession?.sessionId ?? null,
        currentRunId: currentRun?.runId ?? null,
        replayDeviceId: selectedDeviceEntry?.id ?? null,
        mode: currentMode,
        message: trimmed,
        attachments: pendingAttachments.map<ConversationAttachmentInput>((attachment) => ({
          sourcePath: attachment.sourcePath,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          size: attachment.size,
        })),
      });

      setPromptValue('');
      setPendingAttachments([]);

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
      if (result.workstreamPresentation) {
        setWorkstreamPresentation(result.workstreamPresentation);
      }

      await syncE2EConversationState(
        electronAPI,
        result.session?.sessionId ?? currentSession?.sessionId ?? null,
        result.userMessage.turnId,
      );
    } catch (error) {
      const currentMessages = useConversationStore.getState().conversationMessages ?? [];
      const failedSummary = t('app.conversationRequestFailed');
      setConversationMessages(currentMessages.concat(buildLocalConversationErrorTurn({
        trimmed,
        currentMode,
        currentProject,
        currentSession,
        currentRun,
        pendingAttachments,
        errorMessage: error instanceof Error ? error.message : failedSummary,
        failedSummary,
      })));
    } finally {
      setIsPromptSending(false);
    }
  }, [
    currentProject,
    currentMode,
    currentRun,
    currentSession,
    hasActiveConversationTurn,
    hasActiveDebugRun,
    hasOpenedCaptureForCurrentProject,
    isComposerBusy,
    openCaptureRequiredLabel,
    pendingAttachments,
    promptValue,
    selectedDeviceEntry,
    setConversationMessages,
    setCurrentDebugPlan,
    setCurrentMode,
    setCurrentRun,
    setCurrentSession,
    setPendingAttachments,
    setPendingQuestions,
    setPromptValue,
    setWorkstreamPresentation,
    setRuns,
    setSessions,
    showNotice,
    t,
    syncE2EConversationState,
    upsertConversationMessages,
  ]);

  const handlePromptKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handlePromptSend();
    }
  }, [handlePromptSend]);

  return {
    isPromptSending,
    isComposerBusy,
    handlePrimaryStop,
    handlePromptSend,
    handlePromptKeyDown,
  };
}
