import type { AgentRun } from './base';
import type { SessionScope } from '../session';
import type { TimelineProjection } from './projection';
import type {
  BranchNavigatorViewModel,
  RawAuditRef,
  RightPanelViewModel,
} from '../trace';

export interface AgentRunPresentation {
  projectId: string;
  sessionId: string;
  activeBranchId: string;
  mode: import('../session').AppMode;
  updatedAt: string;
  runs: AgentRunViewModel[];
  rightPanel: RightPanelViewModel;
  branchNavigator?: BranchNavigatorViewModel | null;
  rawAuditRefs: RawAuditRef[];
}

export interface AgentRunViewModel {
  run: AgentRun;
  timeline: TimelineProjection;
  inspectorSelection?: string | null;
}

export interface TraceChangedPayload extends SessionScope {
  presentation: AgentRunPresentation;
}

export interface TraceEventAddedPayload {
  runId: string;
  event: import('./events').TraceEvent;
}

export interface TraceProjectionChangedPayload extends SessionScope {
  presentation: AgentRunPresentation;
}

