import type { ProjectRecord, SessionRecord } from '@shared/types/session';
import type { CaptureDescriptor } from '@shared/types/session';
import type { RightRailTarget } from '../../../stores/projectStore';
import { useSessionStore } from '../../../stores/sessionStore';

export type { RightRailTarget };

export interface SessionRenamePopoverState {
  session: SessionRecord;
  x: number;
  y: number;
  titleDraft: string;
}

export interface ProjectMenuPopoverState {
  project: ProjectRecord;
  x: number;
  y: number;
}

export interface ProjectRenamePopoverState {
  project: ProjectRecord;
  x: number;
  y: number;
  titleDraft: string;
}

export interface LoadSessionsOptions {
  preferredSessionId?: string | null;
  autoSelectSession?: boolean;
  rightRailTarget?: RightRailTarget;
  requestId?: number;
  rollbackState?: SelectionSnapshot;
}

export interface LoadProjectsOptions {
  autoSelectSession?: boolean;
  rightRailTarget?: RightRailTarget;
  requestId?: number;
  onProjectsListed?: () => void;
}

export interface SelectSessionOptions {
  optimisticSession?: SessionRecord;
  requestId?: number;
  rollbackState?: SelectionSnapshot;
}

export interface SelectionSnapshot {
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
  rightRailTarget: RightRailTarget;
  currentRun: ReturnType<typeof useSessionStore.getState>['currentRun'];
  captures: CaptureDescriptor[];
  runs: ReturnType<typeof useSessionStore.getState>['runs'];
}
