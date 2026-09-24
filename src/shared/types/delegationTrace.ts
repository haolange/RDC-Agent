export interface DelegationTraceStep {
  id: string;
  kind: 'message' | 'tool' | 'diagnostic';
  status: 'running' | 'complete' | 'error';
  timestamp: number;
  completedAt?: number;
  text?: string;
  toolName?: string;
  args?: string;
  receipt?: string;
  receiptTruncated?: boolean;
  receiptRef?: string;
  eventId?: string;
}

export interface DelegationTraceHeader {
  parentToolCallId: string;
  task: string;
  profile: string;
  mode: 'wait' | 'background';
  executionId?: string;
  generation?: number;
  taskId?: string;
  childSessionId: string;
  invocation: string;
  status: 'running' | 'complete' | 'failed' | 'cancelled' | 'interrupted';
  startedAt: number;
  completedAt?: number;
  result?: string;
}

export interface DelegationTracePage {
  header: DelegationTraceHeader | null;
  steps: DelegationTraceStep[];
  nextCursor: number | null;
  total: number;
  error?: string;
}

export interface DelegationReceiptPage {
  text: string;
  nextOffset: number | null;
  total: number;
}
