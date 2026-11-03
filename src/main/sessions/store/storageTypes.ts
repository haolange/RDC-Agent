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
  };
};

export interface SessionLocation {
  project: ProjectRecord;
  sessionPath: string;
  session?: SessionRecord;
}
