import type { AgentRole } from './agent';
import type { AgentEvent } from './agentRuntime';
import type { AppMode, RunSummary, SessionAttachmentRecord, SessionRecord } from './session';

export type ConversationMode = 'talk';

export type ConversationRole = 'user' | 'assistant' | 'system';

export type ConversationMessageStatus = 'draft' | 'streaming' | 'complete' | 'error' | 'stopped';

export type ConversationWorkBlockStatus = 'pending' | 'running' | 'complete' | 'error';

export type ConversationWorkBlockKind =
  | 'reasoning'
  | 'tool'
  | 'approval'
  | 'user_input'
  | 'compaction'
  | 'subagent'
  | 'handoff'
  | 'diagnostic'
  | 'output'
  | 'command';

export type ConversationToolCallStatus = 'pending' | 'running' | 'complete' | 'error';

export type ConversationMessageDiagnosticCode =
  | 'CONVERSATION_LLM_ROUTE_MISSING'
  | 'CONVERSATION_LLM_PROVIDER_UNAVAILABLE'
  | 'CONVERSATION_LLM_REQUEST_FAILED';

export interface ConversationMessageDiagnostic {
  code: ConversationMessageDiagnosticCode;
  severity: 'warning' | 'error';
  userMessage: string;
  agentId?: AgentRole;
  providerId?: string;
  modelId?: string;
  adapterId?: string;
  technicalMessage?: string;
}

export interface ConversationToolCall {
  id: string;
  toolName: string;
  status: ConversationToolCallStatus;
  argsPreview?: string;
  resultPreview?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface ConversationWorkBlock {
  id: string;
  kind: ConversationWorkBlockKind;
  title: string;
  stage?: string;
  status: ConversationWorkBlockStatus;
  summary?: string;
  detail?: string;
  toolCalls: ConversationToolCall[];
  startedAt: number;
  completedAt?: number;
  /** 嵌套子 block（subagent kind 专用，承载子 agent 的 WorkTrace）。 */
  children?: ConversationWorkBlock[];
}

export interface ConversationWorkTrace {
  status: 'idle' | 'running' | 'complete' | 'error' | 'stopped';
  summary?: string;
  blocks: ConversationWorkBlock[];
  updatedAt: number;
}

export interface ConversationMessage {
  id: string;
  turnId: string;
  sessionId: string | null;
  projectId: string | null;
  runId?: string | null;
  modeContext?: AppMode;
  role: ConversationRole;
  agentId?: AgentRole;
  content: string;
  status?: ConversationMessageStatus;
  updatedAt?: number;
  workTrace?: ConversationWorkTrace | null;
  diagnostic?: ConversationMessageDiagnostic | null;
  attachments?: SessionAttachmentRecord[];
  createdAt: number;
}

export interface ConversationAttachmentInput {
  sourcePath: string;
  fileName: string;
  mimeType?: string | null;
  size?: number | null;
}

export interface ConversationErrorViewModel {
  code: string;
  message: string;
  technicalMessage?: string;
}

export interface ConversationUiHints {
  highlightProjectPicker?: boolean;
  highlightCaptureLibrary?: boolean;
  highlightSettingsRoute?: boolean;
}

export interface ConversationExecutionTransition {
  action: 'none' | 'started_run';
  runId?: string;
  sessionId?: string;
}

export interface ConversationSendRequest {
  projectId?: string | null;
  sessionId?: string | null;
  currentRunId?: string | null;
  replayDeviceId?: string | null;
  mode: AppMode;
  agentId?: string | null;
  message: string;
  attachments?: ConversationAttachmentInput[];
}

export interface ConversationRewriteFromMessageRequest extends ConversationSendRequest {
  messageId: string;
}

export interface ConversationCancelActiveTurnRequest {
  sessionId?: string;
  turnId?: string;
}

export interface ConversationCancelActiveTurnResult {
  success: boolean;
  cancelledTurnId?: string;
  error?: string;
}

export interface ConversationAnswerUserInputRequest {
  sessionId?: string | null;
  turnId: string;
  toolCallId: string;
  answer: string;
}

export interface ConversationAnswerUserInputResult {
  success: boolean;
  error?: string;
}

export interface ConversationAnswerToolApprovalRequest {
  sessionId?: string | null;
  turnId: string;
  approvalId: string;
  approved: boolean;
}

export interface ConversationAnswerToolApprovalResult {
  success: boolean;
  error?: string;
}

export interface ConversationTurnResult {
  session: SessionRecord | null;
  mode: ConversationMode;
  userMessage: ConversationMessage;
  assistantDraftMessage: ConversationMessage;
  executionTransition: ConversationExecutionTransition;
  runUpdate?: RunSummary | null;
  tracePresentation?: import('./agenticTrace').AgentRunPresentation | null;
  uiHints?: ConversationUiHints;
  errorViewModel?: ConversationErrorViewModel | null;
}

export interface ConversationMessagePatchedEvent {
  type: 'message_patched';
  sessionId: string;
  turnId: string;
  message: ConversationMessage;
}

export interface ConversationMessageCompletedEvent {
  type: 'message_completed';
  sessionId: string;
  turnId: string;
  message: ConversationMessage;
}

export interface ConversationMessageErroredEvent {
  type: 'message_errored';
  sessionId: string;
  turnId: string;
  message: ConversationMessage;
}

export interface ConversationRunLinkedEvent {
  type: 'run_linked';
  sessionId: string;
  turnId: string;
  runId: string;
}

export interface ConversationAgentEvent {
  type: 'agent_event';
  sessionId: string;
  turnId: string;
  event: AgentEvent;
}

export type ConversationStreamEvent =
  | ConversationMessagePatchedEvent
  | ConversationMessageCompletedEvent
  | ConversationMessageErroredEvent
  | ConversationRunLinkedEvent
  | ConversationAgentEvent;
