import { useCaptureStore } from '../stores/captureStore';
import { useConversationStore } from '../stores/conversationStore';
import { useProjectStore } from '../stores/projectStore';
import { useSessionStore } from '../stores/sessionStore';
import { useSessionProjectionStore } from '../stores/sessionProjectionStore';
import { useWorkflowStore } from '../stores/workflowStore';
import { useComposerSessionContextStore } from '../stores/composerSessionContextStore';
import { useComposerModelDraftStore } from '../stores/composerModelDraftStore';
import { useSessionRecordStore } from '../stores/sessionRecordStore';

/** Resets session-scoped slices (used by case:new and E2E harness). */
export function resetWorkbenchStores(): void {
  useProjectStore.setState({
    projects: [],
    sessions: [],
    currentProject: null,
    currentSessionId: null,
    rightRailTarget: 'project',
    projectInputs: [],
  });
  useCaptureStore.getState().reset();
  useConversationStore.getState().reset();
  useWorkflowStore.getState().reset();
  useSessionProjectionStore.getState().reset();
  useComposerSessionContextStore.getState().resetForSessionSwitch();
  useComposerSessionContextStore.getState().setLastSent(null);
  useComposerModelDraftStore.getState().reset();
  useSessionRecordStore.getState().reset();
  useSessionStore.setState({
    currentRun: null,
    currentRunUsage: null,
    lastKnownUsage: null,
    usageStale: false,
    preparedTurnContext: null,
    conversationPreparationPhase: 'idle',
    conversationTerminalTurnId: null,
  });
}
