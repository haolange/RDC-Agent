import type { AgentRole } from './agent';
import type { ConversationTurnControls } from './modelCapability';
import type { AgentEvent } from './agentRuntime';
import type { ConversationBranchState } from './conversationBranch';
import type { ThinkingArtifact } from './reasoning';
import type { AppMode, RunSummary, SessionAttachmentRecord, SessionRecord } from './session';

export type ConversationMode = 'talk';

export type ConversationRole = 'user' | 'assistant' | 'system';

export type ConversationMessageStatus = 'draft' | 'streaming' | 'complete' | 'error' | 'stopped';

export type ConversationWorkBlockStatus = 'pending' | 'running' | 'complete' | 'error';

export type ConversationWorkBlockKind =
  | 'reasoning'
  | 'llm_turn'
  | 'approval'
  | 'user_input'
  | 'compaction'
  | 'subagent'
  | 'handoff'
  | 'diagnostic'
  | 'output'
  | 'command';

export type ConversationToolCallStatus = 'pending' | 'running' | 'complete' | 'error';

export type ConversationThinkingStatus = 'streaming' | 'complete';

export type ConversationLoopResultStatus = 'streaming' | 'complete';

export type ConversationLoopStopReason =
  | 'end_turn'
  | 'tool_use'
  | 'max_tokens'
  | 'refusal'
  | 'error'
  | 'aborted';

export type ConversationLoopOutputPhase = 'commentary' | 'final_answer';

export type ConversationReasoningState = 'raw' | 'summary' | 'unknown' | 'opaque' | 'hidden' | 'none';

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
  /** Canonical ask_user payload. Renderer state must never be reconstructed from argsPreview. */
  userInputQuestions?: ConversationAskUserQuestion[];
  argsPreview?: string;
  resultPreview?: string;
  error?: string;
  approval?: ConversationToolApproval;
  startedAt: number;
  completedAt?: number;
}

export type ConversationToolApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ConversationToolApproval {
  approvalId: string;
  status: ConversationToolApprovalStatus;
  reason?: string;
  risk?: 'low' | 'medium' | 'high' | (string & {});
  reviewer?: 'auto_review' | (string & {});
  answer?: string;
  requestedAt?: number;
  resolvedAt?: number;
}

export interface ConversationLoopResult {
  text?: string;
  status: ConversationLoopResultStatus;
  stopReason?: ConversationLoopStopReason;
  outputPhase?: ConversationLoopOutputPhase;
  toolCallIds: string[];
}

export interface ConversationWorkBlock {
  id: string;
  kind: ConversationWorkBlockKind;
  title: string;
  stage?: string;
  status: ConversationWorkBlockStatus;
  /** Non-loop summary text; LLM turn output lives in result and never contains provider thinking text. */
  summary?: string;
  thinking?: ThinkingArtifact;
  thinkingStatus?: ConversationThinkingStatus;
  /** llm_turn only: how provider reasoning was delivered for this loop. */
  reasoningState?: ConversationReasoningState;
  result?: ConversationLoopResult;
  toolCalls: ConversationToolCall[];
  startedAt: number;
  completedAt?: number;
  /** Nested blocks are used by sub-agent traces. */
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
  /** Conversation branch id; defaults to root. */
  branchId?: string;
  /** Fork anchor shared by variants from the same fork. */
  forkId?: string;
  /** Variant index at the fork point, 0-based. */
  variantIndex?: number;
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
  turnControls?: ConversationTurnControls;
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

export interface ConversationAskUserOption {
  optionId: string;
  label: string;
  description?: string;
}

export interface ConversationAskUserQuestion {
  questionId: string;
  prompt: string;
  description?: string;
  options: ConversationAskUserOption[];
  allowFreeform: boolean;
}

export interface ConversationAskUserAnswer {
  questionId: string;
  answer: string;
  selectedOptionId?: string;
}

export interface ConversationAnswerUserInputRequest {
  sessionId?: string | null;
  turnId: string;
  toolCallId: string;
  answers: ConversationAskUserAnswer[];
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
  messages?: ConversationMessage[];
  branchState?: ConversationBranchState | null;
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
