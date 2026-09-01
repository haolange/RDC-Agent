import type {
  ReasoningSummary,
  WorkflowStage,
  Blocker,
} from '@shared/types/workflow';
import type { ProjectRecord, RunRecord, SessionRecord } from '@shared/types/session';

export interface ProjectRegistry {
  schemaVersion: '1';
  projects: ProjectRecord[];
}

export interface SelectionState {
  projectId: string | null;
  sessionId: string | null;
}

export type PersistedRunRecord = RunRecord & {
  createdAt: number;
  updatedAt: number;
  runtime: {
    backend: 'local' | 'remote';
    entry_mode: 'cli' | 'mcp';
    context_id: string | null;
    runtime_owner: string | null;
    session_id: string;
    workflow_stage: WorkflowStage;
  };
};

export interface SessionEvidenceRecord {
  schema_version: '1';
  session_id: string;
  project_id: string;
  latest_run_id: string | null;
  latest_run_status: RunRecord['status'] | null;
  latest_stage: string | null;
  updated_at: string;
  event_counts: Record<string, number>;
  active_blockers: Blocker[];
  verification_summary: string[];
  reasoning_summaries: ReasoningSummary[];
  report_paths: RunRecord['reportPaths'] | null;
}

export interface SessionLocation {
  project: ProjectRecord;
  sessionPath: string;
  session?: SessionRecord;
}
