import type { AgentMode } from '@shared/types/layout';
import type { AppSettings } from '@shared/types/settings';
import type { ActionEvent } from '@shared/types/evidence';
import type { AgentTimelineEntry } from '@shared/types/agent';
import type { ConversationAttachmentInput, ConversationMessage } from '@shared/types/conversation';
import type {
  CaptureDescriptor,
  ContextSnapshot,
  OpenedCaptureState,
  ProjectInputRecord,
  ProjectRecord,
  RunContextUsageSummary,
  RunSummary,
  SessionAttachmentRecord,
  SessionRecord,
} from '@shared/types/session';
import type { WorkflowState } from '@shared/types/workflow';
import type { AgentWorkstreamPresentation } from '@shared/types/workstream';
import type { RightRailTarget } from '../../stores/projectStore';

export interface PendingAttachmentDraft extends ConversationAttachmentInput {
  id: string;
  kind: SessionAttachmentRecord['kind'];
  isCapture: boolean;
}

export interface WorkbenchSeedState {
  projects: ProjectRecord[];
  sessions: SessionRecord[];
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
  rightRailTarget?: RightRailTarget;
  currentRun: RunSummary | null;
  currentRunUsage?: RunContextUsageSummary | null;
  contextSnapshot: ContextSnapshot | null;
  captures: CaptureDescriptor[];
  projectInputs: ProjectInputRecord[];
  openedCapture: OpenedCaptureState | null;
  conversationMessages?: ConversationMessage[];
  timeline: AgentTimelineEntry[];
  actionEvents?: ActionEvent[];
  workflowState?: WorkflowState | null;
  workstreamPresentation?: AgentWorkstreamPresentation | null;
  runs?: RunSummary[];
}

export type E2EWindow = Window & {
  __RDC_AGENT_E2E__?: {
    seedWorkbenchState: (state: WorkbenchSeedState) => void;
    resetWorkbenchState: () => void;
    getWorkbenchState: () => WorkbenchSeedState;
    setAppSettings: (settings: AppSettings) => void;
    setComposerDraftState: (state: {
      promptValue?: string;
      pendingAttachments?: PendingAttachmentDraft[];
      currentMode?: AgentMode;
    }) => void;
  };
};
