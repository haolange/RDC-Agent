export type TerminalTabKind = 'shell' | 'logs';

export type TerminalTabStatus = 'running' | 'exited';

export interface TerminalTabRecord {
  tabId: string;
  kind: TerminalTabKind;
  title: string;
  cwd: string;
  status: TerminalTabStatus;
  createdAt: number;
  sessionId?: string | null;
  projectId?: string | null;
  runId?: string | null;
  exitCode?: number | null;
}

export interface TerminalCreateTabRequest {
  cwd?: string | null;
  sessionId?: string | null;
  projectId?: string | null;
  runId?: string | null;
}

export interface TerminalDataEvent {
  tabId: string;
  data: string;
}

export interface TerminalExitEvent {
  tabId: string;
  exitCode: number | null;
}
