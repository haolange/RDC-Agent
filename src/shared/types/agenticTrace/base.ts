export type TraceStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped' | 'waiting_approval';

export interface AgentRun {
  runId: string;
  agentType: string;
  title?: string;
  userRequest: string;
  status: TraceStatus;
  createdAt: string;
  updatedAt: string;
  context?: Record<string, unknown>;
  profileVersion?: string;
}
