import type { AgentPermissionMode } from './settings';

/** Main-owned current authorization mode; revision is local to the app process. */
export interface RuntimePermissionState {
  readonly mode: AgentPermissionMode;
  readonly revision: number;
}
