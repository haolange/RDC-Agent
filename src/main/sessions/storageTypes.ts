import type {
  AskUserPrompt,
  DebugPlan,
  IntakeContext,
  PlanApprovalState,
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

export interface PersistedRunRecord extends RunRecord {
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
}

export interface SessionEvidenceRecord {
  schema_version: '1';
  session_id: string;
  project_id: string;
  latest_run_id: string | null;
  latest_run_status: RunRecord['status'] | null;
  latest_stage: string | null;
  updated_at: string;
  debug_plan: {
    plan_id: string;
    readiness: string;
    strict_ready: boolean;
    target_capture: string | null;
    target_scope: string | null;
    deliverables: string[];
  } | null;
  event_counts: Record<string, number>;
  active_blockers: Blocker[];
  verification_summary: string[];
  reasoning_summaries: ReasoningSummary[];
  report_paths: RunRecord['reportPaths'] | null;
}

export interface PersistedPlanSnapshot {
  debug_plan: DebugPlan | null;
  pending_questions: AskUserPrompt | null;
  approval_state: PlanApprovalState;
  intake_context?: IntakeContext;
}

export interface SessionLocation {
  project: ProjectRecord;
  sessionPath: string;
  session?: SessionRecord;
}
