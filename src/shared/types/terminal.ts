export type TerminalTabKind = 'shell' | 'logs';

export type TerminalTabStatus = 'running' | 'exited';

export interface TerminalTabRecord {
  tabId: string;
  kind: TerminalTabKind;
  title: string;
  cwd: string;
  status: TerminalTabStatus;
  createdAt: number;
  exitCode?: number | null;
}

export interface TerminalDataEvent {
  tabId: string;
  data: string;
}

export interface TerminalExitEvent {
  tabId: string;
  exitCode: number | null;
}
