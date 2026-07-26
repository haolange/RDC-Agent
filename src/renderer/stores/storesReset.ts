import { useCaptureStore } from './captureStore';
import { useConversationStore } from './conversationStore';
import { useEvidenceStore } from './evidenceStore';
import { useProjectStore } from './projectStore';
import { useSessionStore } from './sessionStore';
import { useSessionProjectionStore } from './sessionProjectionStore';
import { useWorkflowStore } from './workflowStore';
import { useComposerSessionContextStore } from '../features/debugger/composer/composerSessionContext';

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
