import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useCaptureStore } from '../../stores/captureStore';
import { useConversationStore } from '../../stores/conversationStore';
import { useEvidenceStore } from '../../stores/evidenceStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { resetWorkbenchStores } from '../../stores/storesReset';
import type { E2EWindow, PendingAttachmentDraft } from './types';

export function useE2ESeedHarness(options: {
  setPromptValue: (value: string) => void;
  setPendingAttachments: Dispatch<SetStateAction<PendingAttachmentDraft[]>>;
}): void {
  const { setPromptValue, setPendingAttachments } = options;

  useEffect(() => {
    if (!navigator.webdriver) return;

    const target = window as E2EWindow;
    target.__RDC_AGENT_E2E__ = {
      seedWorkbenchState: (state) => {
        const project = useProjectStore.getState();
        project.setProjects(state.projects);
        project.setSessions(state.sessions);
        project.setCurrentProject(state.currentProject);
        project.setCurrentSession(state.currentSession);
        project.setRightRailTarget(state.rightRailTarget ?? (state.currentSession ? 'session' : 'project'));
        project.setProjectInputs(state.projectInputs);
        if (state.currentProject) {
          project.updateProjectInputs(state.currentProject.projectId, state.projectInputs);
        }

        const capture = useCaptureStore.getState();
        capture.setContextSnapshot(state.contextSnapshot);
        capture.setCaptures(state.captures);
        capture.setOpenedCapture(state.openedCapture);

        const conversation = useConversationStore.getState();
        conversation.setConversationMessages(state.conversationMessages ?? []);
        conversation.setTimeline(state.timeline);
        conversation.setReasoningSummaries(state.workflowState?.reasoningSummaries ?? []);

        const evidence = useEvidenceStore.getState();
        evidence.setActionEvents(state.actionEvents ?? []);

        const workflow = useWorkflowStore.getState();
        workflow.setWorkflowState(state.workflowState ?? null);
        workflow.setWorkstreamPresentation(state.workstreamPresentation ?? null);
        workflow.setCurrentDebugPlan(state.workflowState?.debugPlan ?? null);
        workflow.setPendingQuestions(state.workflowState?.pendingQuestions ?? null);

        const session = useSessionStore.getState();
        session.setCurrentRun(state.currentRun);
        session.setCurrentRunUsage(state.currentRunUsage ?? null);
        session.setRuns(state.runs ?? []);
      },
      resetWorkbenchState: () => {
        resetWorkbenchStores();
      },
      getWorkbenchState: () => {
        const project = useProjectStore.getState();
        const capture = useCaptureStore.getState();
        const conversation = useConversationStore.getState();
        const workflow = useWorkflowStore.getState();
        const session = useSessionStore.getState();
        return {
          projects: project.projects,
          sessions: project.sessions,
          currentProject: project.currentProject,
          currentSession: project.currentSession,
          rightRailTarget: project.rightRailTarget,
          currentRun: session.currentRun,
          currentRunUsage: session.currentRunUsage,
          contextSnapshot: capture.contextSnapshot,
          captures: capture.captures,
          projectInputs: project.projectInputs,
          openedCapture: capture.openedCapture,
          conversationMessages: conversation.conversationMessages,
          timeline: conversation.timeline,
          actionEvents: useEvidenceStore.getState().actionEvents,
          workflowState: workflow.workflowState,
          workstreamPresentation: workflow.workstreamPresentation,
          runs: session.runs,
        };
      },
      setAppSettings: (nextSettings) => {
        useAppSettingsStore.getState().hydrate(nextSettings, useAppSettingsStore.getState().systemTheme);
      },
      setComposerDraftState: (state) => {
        if (typeof state.promptValue === 'string') {
          setPromptValue(state.promptValue);
        }
        if (Array.isArray(state.pendingAttachments)) {
          setPendingAttachments(state.pendingAttachments);
        }
        if (state.currentMode) {
          useLayoutStore.getState().setCurrentMode(state.currentMode);
        }
      },
    };

    return () => {
      delete target.__RDC_AGENT_E2E__;
    };
  }, [setPendingAttachments, setPromptValue]);
}
