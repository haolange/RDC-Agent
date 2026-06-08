import type { AgentRun } from './base';
import type { TimelineProjection } from './projection';
import type {
  BranchNavigatorViewModel,
  ComposerApprovalViewModel,
  RawAuditRef,
  RightPanelViewModel,
} from '../trace';

export interface AgentRunPresentation {
  sessionId: string;
  activeBranchId: string;
  mode: import('../session').AppMode;
  updatedAt: string;
  runs: AgentRunViewModel[];
  rightPanel: RightPanelViewModel;
  approval?: ComposerApprovalViewModel | null;
  branchNavigator?: BranchNavigatorViewModel | null;
  rawAuditRefs: RawAuditRef[];
}

export interface AgentRunViewModel {
  run: AgentRun;
  timeline: TimelineProjection;
  inspectorSelection?: string | null;
}

export interface TraceChangedPayload {
  sessionId: string;
  presentation: AgentRunPresentation;
}

export interface TraceEventAddedPayload {
  runId: string;
  event: import('./events').TraceEvent;
}

export interface TraceProjectionChangedPayload {
  runId: string;
  presentation: AgentRunPresentation;
}

