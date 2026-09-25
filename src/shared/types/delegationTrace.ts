import type { DelegationCapsule } from './delegationCapsule';
import type { ConversationWorkBlock } from './conversation';

export interface DelegationTraceStep {
  id: string;
  block: ConversationWorkBlock;
  revision: number;
}

export type DelegationContentKind = 'task' | 'final' | 'invocation' | 'parent_receipt' | 'tool_receipt' | 'sent_prompt';

export interface DelegationTaskBody {
  capsule: DelegationCapsule;
  completionRequirements: string[];
}

export interface DelegationTraceHeader {
  recordVersion: 2;
  sentPromptAvailable?: boolean;
  parentToolCallId: string;
  /** First paragraph only; the structured task and exact sent prompt are separate owned bodies. */
  task: string;
  taskLength: number;
  taskAvailable: boolean;
  invocationAvailable: boolean;
  profile: string;
  mode: 'wait' | 'background';
  executionId?: string;
  generation?: number;
  taskId?: string;
  childSessionId: string;
  status: 'running' | 'complete' | 'failed' | 'cancelled' | 'interrupted';
  /** Durable Task Execution lifecycle for background delegations; distinct from the child turn result. */
  executionStatus?: 'queued' | 'running' | 'waiting' | 'cancelling' | 'completed' | 'partial' | 'blocked' | 'failed' | 'cancelled' | 'interrupted';
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  finalPreview?: string;
  finalLength?: number;
  finalAvailable?: boolean;
  finalUnavailableReason?: string;
  error?: string;
  parentReceiptPreview?: string;
  parentReceiptAvailable?: boolean;
  latestAction?: string;
  latestActionStatus?: import('./conversation').ConversationToolCall['status'];
  total: number;
  revision: number;
}

export interface DelegationTracePage {
  header: DelegationTraceHeader | null;
  steps: DelegationTraceStep[];
  nextCursor: number | null;
  total: number;
  revision: number;
  error?: string;
}

export interface DelegationContentPage {
  text: string;
  /** UTF-8 byte offset for the next chunk; null when complete. */
  nextOffset: number | null;
  /** Total UTF-8 bytes in the session-owned body. */
  total: number;
}

export interface DelegationContentRequest {
  sessionId: string;
  parentToolCallId: string;
  childSessionId: string;
  executionId?: string;
  generation?: number;
  kind: DelegationContentKind;
  stepId?: string;
  offset: number;
}
