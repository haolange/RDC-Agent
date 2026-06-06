export type TraceEventType =
  | 'node.created'
  | 'node.updated'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'phase.started'
  | 'phase.completed'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled';

export interface TraceEvent {
  eventId: string;
  runId: string;
  seq: number;
  timestamp: string;
  type: TraceEventType;
  payload: unknown;
  visibility: 'user' | 'debug' | 'internal';
}

export interface GetRunEventsResponse {
  events: TraceEvent[];
}

export interface CreateRunResponse {
  runId: string;
  status: import('./base').TraceStatus;
}

export interface RetryRequest {
  nodeId?: string;
  fromSeq?: number;
}

export interface ApprovalResolveRequest {
  approvalId: string;
  actionId: string;
  comment?: string;
}
