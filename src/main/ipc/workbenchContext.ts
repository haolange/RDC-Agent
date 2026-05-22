import type {
  RunSummary,
  SessionOutputRecord,
  SessionRecord,
  ProjectRecord,
} from '@shared/types/session';

export interface WorkbenchIpcState {
  currentSessionId: string | null;
  currentProjectId: string | null;
  currentRunId: string | null;
}

export interface RunLifecyclePatch {
  status: RunSummary['status'];
  lastStage?: string;
  stopReason?: string;
  stoppedAt?: number;
  finishedAt?: number;
}

export interface ProjectSelectionResult {
  project: ProjectRecord | null;
  currentSession: SessionRecord | null;
  currentRun: RunSummary | null;
}

export interface WorkbenchIpcContext {
  state: WorkbenchIpcState;
  broadcastToRenderer(channel: string, ...args: unknown[]): void;
  broadcastRunStatusChanged(payload: {
    runId: string;
    sessionId: string;
    status: string;
    lastStage?: string;
    stopReason?: string;
  }): void;
  applyCurrentLlmConfig(): void;
  setRunLifecycleState(sessionId: string, runId: string, patch: RunLifecyclePatch): Promise<void>;
  selectCurrentProject(projectId: string | null): Promise<ProjectSelectionResult>;
  buildSessionOutputs(sessionId: string, runId?: string): Promise<SessionOutputRecord[]>;
  initializeIpcState(): Promise<void>;
}
