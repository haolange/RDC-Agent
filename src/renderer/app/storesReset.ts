import { useCaptureStore } from '../stores/captureStore';
import { useConversationStore } from '../stores/conversationStore';
import { useEvidenceStore } from '../stores/evidenceStore';
import { useProjectStore } from '../stores/projectStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSessionProjectionStore } from '../stores/sessionProjectionStore';
import { useWorkflowStore } from '../stores/workflowStore';
import { useComposerSessionContextStore } from '../features/debugger/composer/composerSessionContext';
import { useComposerModelDraftStore } from '../features/debugger/composer/composerModelDraft';

/** Resets session-scoped slices (used by case:new and E2E harness). */
export function resetWorkbenchStores(): void {
  useProjectStore.setState({
    projects: [],
    sessions: [],
    currentProject: null,
    currentSession: null,
    rightRailTarget: 'project',
    projectInputs: [],
  });
  useCaptureStore.getState().reset();
  useConversationStore.getState().reset();
  useEvidenceStore.getState().reset();
  useWorkflowStore.getState().reset();
  useSessionProjectionStore.getState().reset();
  useComposerSessionContextStore.getState().resetForSessionSwitch();
  useComposerSessionContextStore.getState().setLastSent(null);
  useComposerModelDraftStore.getState().reset();
  useSessionStore.setState({
    runs: [],
    currentRun: null,
    currentRunUsage: null,
    lastKnownUsage: null,
    usageStale: false,
    preparedTurnContext: null,
    conversationPreparationPhase: 'idle',
    conversationTerminalTurnId: null,
    isLoading: false,
  });
}
