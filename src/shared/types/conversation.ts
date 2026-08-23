import type { AgentRole } from './agent';
import type { ConversationTurnControls } from './modelCapability';
import type { AgentEvent } from './agentRuntime';
import type { ConversationBranchState } from './conversationBranch';
import type { ProviderOutputRef, ThinkingArtifact } from './reasoning';
import type {
  AppMode,
  PreparedTurnContextSummary,
  RunSummary,
  SessionAttachmentLayer,
  SessionAttachmentRecord,
  SessionRecord,
} from './session';

export type ConversationMode = 'talk';

export type ConversationRole = 'user' | 'assistant' | 'system';

export type ConversationMessageStatus = 'draft' | 'streaming' | 'complete' | 'error' | 'stopped';

export type ConversationWorkBlockStatus = 'pending' | 'running' | 'complete' | 'error';

/** Durable TaskRegistry lifecycle state carried by task work-trace blocks. */
export type ConversationTaskStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';

export type ConversationDiagnosticSeverity = 'info' | 'warning' | 'error';

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
  | 'command'
  | 'task_snapshot';

export type ConversationCompactionProvenance = 'auto' | 'manual';

export interface ConversationTaskSnapshotItem {
  taskId: string;
  title: string;
  status: ConversationTaskStatus;
  statusReason?: string;
}

export interface ConversationTaskSnapshot {
  completed: number;
  total: number;
  items: ConversationTaskSnapshotItem[];
}

export interface ConversationCompactionStats {
  provenance: ConversationCompactionProvenance;
  messagesBefore?: number;
  messagesAfter?: number;
  tokensBefore?: number;
  tokensAfter?: number;
}

export interface ConversationToolImagePreviewRef {
  previewId: string;
  fileName: string;
  mimeType: string;
  width?: number;
  height?: number;
}

export type ConversationToolCallStatus = 'pending' | 'running' | 'complete' | 'error' | 'skipped';

export type ConversationToolResourceKind = 'file' | 'directory' | 'skill' | 'mcp' | 'web';

/**
 * Sanitized resource evidence emitted by a successful tool call.
 * Arbitrary tool arguments and result payloads must never be copied here.
 */
export interface ConversationToolResourceRef {
  id: string;
  kind: ConversationToolResourceKind;
  label: string;
  summary?: string;
  path?: string;
  url?: string;
}

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
  | 'CONVERSATION_LLM_TOOLS_UNAVAILABLE'
  | 'CONVERSATION_LLM_REQUEST_FAILED'
  | 'CONVERSATION_PROVIDER_STREAM_PROTOCOL_VIOLATION'
  | 'CONVERSATION_AGENT_LOOP_STALLED'
  | 'CONVERSATION_AGENT_TURN_LIMIT_EXCEEDED'
  | 'MODEL_CONTINUATION_DROPPED'
  | 'ATTACHMENT_LIMIT_EXCEEDED'
  | 'ATTACHMENT_MEDIA_UNSUPPORTED'
  | 'ATTACHMENT_NOT_FOUND'
  | 'ATTACHMENT_INVALID'
  | 'VISION_INPUT_UNSUPPORTED';

export interface ConversationMessageDiagnostic {
  code: ConversationMessageDiagnosticCode;
  severity: 'warning' | 'error';
  userMessage: string;
  agentId?: AgentRole;
  providerId?: string;
  modelId?: string;
  adapterId?: string;
  technicalMessage?: string;
  recommendations?: Array<{ providerId: string; modelId: string; label: string }>;
}

export interface ConversationToolCall {
  id: string;
  toolName: string;
  status: ConversationToolCallStatus;
  providerOutputRef?: ProviderOutputRef;
  /** Canonical ask_user payload. Renderer state must never be reconstructed from argsPreview. */
  userInputQuestions?: ConversationAskUserQuestion[];
  argsPreview?: string;
  resultPreview?: string;
  /** Canonical, non-sensitive resources proven by this tool result. */
  resourceRefs?: ConversationToolResourceRef[];
  /** Session-scoped thumbnail refs; renderer fetches pixels via conversation:getToolImagePreview. */
  imagePreviews?: ConversationToolImagePreviewRef[];
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
  providerOutputRefs?: ProviderOutputRef[];
  toolCallIds: string[];
}

export interface ConversationWorkBlock {
  id: string;
  kind: ConversationWorkBlockKind;
  title: string;
  stage?: string;
  status: ConversationWorkBlockStatus;
  /** Present only for TaskRegistry-backed work blocks; never synthesized by the renderer. */
  taskStatus?: ConversationTaskStatus;
  taskStatusReason?: string;
  /** Adjacent task_* mutations merge into one snapshot; non-adjacent snapshots keep loop history. */
  taskSnapshot?: ConversationTaskSnapshot;
  compactionStats?: ConversationCompactionStats;
  /** Non-loop summary text; LLM turn output lives in result and never contains provider thinking text. */
  summary?: string;
  /** Diagnostic blocks only: preserves runtime severity through storage and renderer projection. */
  diagnosticSeverity?: ConversationDiagnosticSeverity;
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
  toolEvidence?: ConversationToolExecutionEvidence;
  blocks: ConversationWorkBlock[];
  updatedAt: number;
}

export interface ConversationToolExecutionEvidence {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export interface ConversationMessage {
  id: string;
  /** Stable idempotency key for the user request that created this message. */
  requestId?: string;
  /** Canonical request fingerprint persisted for restart-safe idempotency. */
  requestFingerprint?: string;
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
  /** Frozen preflight summary persisted on both turn messages for restart-safe idempotency and trace audit. */
  preparedContext?: PreparedTurnContextSummary;
}

export type AttachmentLayer = SessionAttachmentLayer;

export type AttachmentRejectCode =
  | 'ATTACHMENT_CAPTURE_USE_PROJECT_IMPORT'
  | 'ATTACHMENT_EXECUTABLE_DENIED'
  | 'ATTACHMENT_LIMIT_EXCEEDED'
  | 'ATTACHMENT_INVALID'
  | 'ATTACHMENT_MEDIA_UNSUPPORTED'
  | 'ATTACHMENT_NOT_FOUND';

export interface ComposerAttachmentError {
  code: AttachmentRejectCode;
  message: string;
}

/** Renderer-facing record returned by conversation:stageAttachments. */
export interface ComposerAttachmentDescriptor {
  stagingId: string;
  fileName: string;
  mimeType: string;
  size: number;
  layer: AttachmentLayer;
  kind: SessionAttachmentRecord['kind'];
  sourcePath: string;
  previewId?: string;
  error?: ComposerAttachmentError;
}

export interface ConversationAttachmentStagePathItem {
  sourcePath: string;
  fileName?: string;
}

export interface ConversationAttachmentStageBytesItem {
  fileName: string;
  mimeType?: string | null;
  bytesBase64: string;
}

export type ConversationAttachmentStageItem =
  | ConversationAttachmentStagePathItem
  | ConversationAttachmentStageBytesItem;

export interface ConversationStageAttachmentsRequest {
  items: ConversationAttachmentStageItem[];
  composerScopeKey: string;
}

export interface ConversationStageAttachmentsResult {
  attachments: ComposerAttachmentDescriptor[];
}

export interface ConversationReleaseAttachmentsRequest {
  stagingIds: string[];
}

export interface ConversationReleaseAttachmentsResult {
  released: string[];
}

export interface ConversationGetAttachmentPreviewRequest {
  previewId: string;
  sessionId?: string;
  composerScopeKey?: string;
}

export interface ConversationGetAttachmentPreviewResult {
  dataUrl: string | null;
  error?: string;
}

export interface ConversationAttachmentInput {
  sourcePath: string;
  fileName: string;
  mimeType?: string | null;
  size?: number | null;
  stagingId?: string;
}

export interface ConversationErrorViewModel {
  code: string;
  message: string;
  technicalMessage?: string;
}

export interface ConversationUiHints {
  highlightProjectPicker?: boolean;
  highlightSettingsRoute?: boolean;
}

export interface ConversationExecutionTransition {
  action: 'none' | 'started_run';
  runId?: string;
  sessionId?: string;
}

export interface ConversationSendRequest {
  requestId: string;
  projectId?: string | null;
  sessionId?: string | null;
  currentRunId?: string | null;
  replayDeviceId?: string | null;
  mode: AppMode;
  agentId?: string | null;
  message: string;
  attachments?: ConversationAttachmentInput[];
  /** Composer `/skills` 武装的当轮预载 skill id（与 `$skill` / profile.skills 合并）。 */
  preloadSkillIds?: string[];
  turnControls: ConversationTurnControls;
  /** Exact committed configuration observed by the renderer before send. */
  configurationCommit?: {
    agentId: string;
    agentCommitHash?: string;
    providerId?: string;
    modelId?: string;
    providerCommitHash?: string;
    providerCatalogRevision?: string;
    routeRevision?: string;
  };
}

export interface ConversationRewriteFromMessageRequest extends ConversationSendRequest {
  messageId: string;
}

export interface ConversationCancelActiveTurnRequest {
  requestId?: string;
  sessionId?: string;
  turnId?: string;
}

export interface ConversationCancelActiveTurnResult {
  success: boolean;
  phase?: 'preparing' | 'committing' | 'running';
  cancelledRequestId?: string;
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
  requestId: string;
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
  preparedContext: PreparedTurnContextSummary;
}

export type ConversationPreflightErrorCode =
  | 'REQUEST_CANCELLED'
  | 'REQUEST_ID_CONFLICT'
  | 'CONVERSATION_BUSY'
  | 'AGENT_COMMIT_NOT_FOUND'
  | 'AGENT_PROFILE_UNAVAILABLE'
  | 'PROVIDER_UNAVAILABLE'
  | 'MODEL_UNAVAILABLE'
  | 'NO_USABLE_CONTEXT_TIER'
  | 'PLAN_CONFLICT'
  | 'CONSTRAINT_REJECTED'
  | 'ATTACHMENT_INVALID'
  | 'ATTACHMENT_LIMIT_EXCEEDED'
  | 'ATTACHMENT_MEDIA_UNSUPPORTED'
  | 'ATTACHMENT_NOT_FOUND'
  | 'VISION_INPUT_UNSUPPORTED'
  | 'PROMPT_PLAN_UNAVAILABLE'
  | 'PROMPT_OVERHEAD_EXCEEDS_BUDGET'
  | 'CONTEXT_CANNOT_FIT'
  | 'TURN_COMMIT_FAILED'
  | 'PREFLIGHT_FAILED';

export type ConversationSendResult =
  | {
      status: 'accepted';
      requestId: string;
      turn: ConversationTurnResult;
      preparedContext: PreparedTurnContextSummary;
    }
  | {
      status: 'rejected';
      requestId: string;
      phase: 'preflight' | 'commit';
      error: {
        code: ConversationPreflightErrorCode;
        message: string;
        technicalMessage?: string;
        retryable: boolean;
        suggestedControls?: ConversationTurnControls;
      };
    };

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
