import type { TurnStopCause } from './lifecycle';
import type { AgentRole } from './agent';
import type { TaskDependencyWait } from './taskExecution';
import type { ConversationTurnControls } from './modelCapability';
import type { AgentEvent } from './agentRuntime';
import type { ConversationBranchState } from './conversationBranch';
import type { ProviderOutputRef, ThinkingArtifact } from './reasoning';
import type { ConversationPlanReview, PlanReviewHandoffSuggestion } from './planReview';
import type {
  PreparedTurnContextSummary,
  RunSummary,
  SessionAttachmentLayer,
  SessionAttachmentRecord,
  SessionRecordSnapshot,
} from './session';
import type { ConversationMessageDelta } from '../conversation/messageDelta';

type ConversationMode = 'talk';

type ConversationRole = 'user' | 'assistant' | 'system';

export type ConversationMessageStatus = 'draft' | 'streaming' | 'complete' | 'error' | 'stopped';

type ConversationWorkBlockStatus = 'pending' | 'running' | 'complete' | 'error' | 'cancelled';

/** Durable TaskRegistry lifecycle state carried by task work-trace blocks. */
export type ConversationTaskStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';

/**
 * What a Task shows: its TaskRegistry status, or `failed` while the logical Task is still open but its current
 * execution ended `failed` / `interrupted` (TaskRegistry records such a Task as `blocked` with the error as reason).
 */
export type TaskDisplayState = ConversationTaskStatus | 'failed';

export type ConversationDiagnosticSeverity = 'info' | 'warning' | 'error';

type ConversationWorkBlockKind =
  | 'reasoning'
  | 'llm_turn'
  | 'approval'
  | 'user_input'
  | 'plan_review'
  | 'compaction'
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
  /** Projected display state at the moment of the snapshot; absent on snapshots recorded before it existed. */
  displayState?: TaskDisplayState;
  statusReason?: string;
  waitingOn?: TaskDependencyWait[];
  order: number;
}

interface ConversationTaskSnapshot {
  change?: 'created' | 'updated';
  completed: number;
  total: number;
  items: ConversationTaskSnapshotItem[];
}

interface ConversationCompactionStats {
  usage?: { inputTokens: number; outputTokens: number };
  provenance: ConversationCompactionProvenance;
  sourceUri?: string;
  sourceHash?: string;
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

type ConversationToolCallStatus = 'pending' | 'running' | 'complete' | 'error' | 'skipped' | 'cancelled';

type ConversationToolResourceKind = 'file' | 'directory' | 'skill' | 'mcp' | 'web';

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

export type ConversationLoopStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'error' | 'aborted';

export type ConversationLoopOutputPhase = 'commentary' | 'final_answer';

export type ConversationReasoningState = 'raw' | 'summary' | 'unknown' | 'opaque' | 'hidden' | 'none';

type ConversationMessageDiagnosticCode =
  | 'CONVERSATION_LLM_ROUTE_MISSING'
  | 'CONVERSATION_LLM_PROVIDER_UNAVAILABLE'
  | 'CONVERSATION_LLM_TOOLS_UNAVAILABLE'
  | 'CONVERSATION_LLM_MODEL_AVAILABILITY_UNVERIFIED'
  | 'CONVERSATION_LLM_REQUEST_FAILED'
  | 'CONVERSATION_CONTEXT_COMPACTION_FAILED'
  | 'CONVERSATION_ARTIFACT_QUOTA_EXCEEDED'
  | 'CONVERSATION_INTERRUPTED'
  | 'CONVERSATION_PROVIDER_STREAM_PROTOCOL_VIOLATION'
  | 'CONVERSATION_AGENT_LOOP_STALLED'
  | 'CONVERSATION_AGENT_TURN_LIMIT_EXCEEDED'
  | 'CONVERSATION_TASK_COMPLETION_DENIED'
  | 'MISSION_COMPLETION_DENIED'
  | 'CONVERSATION_PROFILE_OVERLAY_INVALID'
  | 'MODEL_CONTINUATION_DROPPED'
  | 'ATTACHMENT_LIMIT_EXCEEDED'
  | 'ATTACHMENT_MEDIA_UNSUPPORTED'
  | 'ATTACHMENT_NOT_FOUND'
  | 'ATTACHMENT_INVALID'
  | 'VISION_INPUT_UNSUPPORTED';

/** Reasoning continuation artifacts dropped by a route or model change, with the per-reason breakdown. */
export interface ConversationContinuationDrop {
  count: number;
  reasons: Array<{ reason: string; count: number }>;
}

interface ConversationMessageDiagnosticBase {
  code: Exclude<ConversationMessageDiagnosticCode, 'MODEL_CONTINUATION_DROPPED'>;
  severity: 'warning' | 'error';
  userMessage: string;
  agentId?: AgentRole;
  providerId?: string;
  modelId?: string;
  adapterId?: string;
  technicalMessage?: string;
  recommendations?: Array<{ providerId: string; modelId: string; label: string }>;
}

/** A model-switch notice always states how many continuation artifacts were dropped. */
export interface ConversationContinuationDropDiagnostic extends Omit<ConversationMessageDiagnosticBase, 'code'> {
  code: 'MODEL_CONTINUATION_DROPPED';
  continuationDrop: ConversationContinuationDrop;
}

export type ConversationMessageDiagnostic = ConversationMessageDiagnosticBase | ConversationContinuationDropDiagnostic;

export interface ConversationToolCall {
  /** Runtime Hook events owned by this exact call, in arrival order. */
  hookDiagnostics?: Array<{
    id: string;
    code: string;
    severity: ConversationDiagnosticSeverity;
    message: string;
    timestamp: number;
  }>;
  delegation?: {
    task: string;
    profile: string;
    mode: 'wait' | 'background';
    executionId?: string;
    generation?: number;
  };
  delegatedRequest?: { executionId: string; childSessionId: string; turnId: string; toolCallId: string };
  id: string;
  toolName: string;
  status: ConversationToolCallStatus;
  providerOutputRef?: ProviderOutputRef;
  /** Canonical ask_user payload. Renderer state must never be reconstructed from argsPreview. */
  userInputQuestions?: ConversationAskUserQuestion[];
  /** Canonical plan_artifact review payload. Renderer state must never be reconstructed from argsPreview. */
  planReview?: ConversationPlanReview;
  argsPreview?: string;
  resultPreview?: string;
  /** Canonical, non-sensitive resources proven by this tool result. */
  resourceRefs?: ConversationToolResourceRef[];
  /** Session-scoped thumbnail refs; renderer fetches pixels via conversation:getToolImagePreview. */
  imagePreviews?: ConversationToolImagePreviewRef[];
  error?: string;
  approval?: ConversationToolApproval;
  /** Scheduler start, separate from the earlier model declaration timestamp. */
  executionStartedAt?: number;
  /** First visible event order within this trace; updates retain the original position. */
  displayOrder?: number;
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
  /** Host-selected route; absent in historical records means unknown. */
  reviewMethod?: 'rule' | 'model';
  /** Host-confirmed review failure, never parsed from the model's reason. */
  errorCode?: string;
  answer?: string;
  requestedAt?: number;
  resolvedAt?: number;
}

export interface ConversationLoopResult {
  status: ConversationLoopResultStatus;
  stopReason?: ConversationLoopStopReason;
  outputPhase?: ConversationLoopOutputPhase;
  providerOutputRefs?: ProviderOutputRef[];
  toolCallIds: string[];
}

/** One provider text block, kept at its first visible position for the whole turn. */
export interface ConversationTextItem {
  kind: 'text';
  providerOutputRef: ProviderOutputRef;
  text: string;
  /** Provider-declared phase, or the one the runtime stamps once when the loop settles. */
  phase?: ConversationLoopOutputPhase;
  status: 'streaming' | 'complete';
  displayOrder: number;
}

/** One provider thinking block; a loop may stream several, each in its own place. */
export interface ConversationThinkingItem {
  kind: 'thinking';
  providerOutputRef: ProviderOutputRef;
  thinking: ThinkingArtifact;
  status: ConversationThinkingStatus;
  displayOrder: number;
  /** When this block's first visible text arrived. */
  startedAt?: number;
  /** When it settled after streaming; absent for blocks that arrived already complete. */
  completedAt?: number;
}

/** What a model turn produced, in the order it became visible. */
export type ConversationLoopItem = ConversationTextItem | ConversationThinkingItem;

export interface ConversationWorkBlock {
  id: string;
  kind: ConversationWorkBlockKind;
  title: string;
  stage?: string;
  status: ConversationWorkBlockStatus;
  /** One live snapshot per turn; canonical order and derived status come from main-side projection. */
  taskSnapshot?: ConversationTaskSnapshot;
  /** Owning model turn and first visible event order for a task snapshot. */
  parentLoopId?: string;
  displayOrder?: number;
  compactionStats?: ConversationCompactionStats;
  /** Non-loop summary text; LLM turn output lives in result and never contains provider thinking text. */
  summary?: string;
  /** Diagnostic blocks only: preserves runtime severity through storage and renderer projection. */
  diagnosticSeverity?: ConversationDiagnosticSeverity;
  /** llm_turn only: how provider reasoning was delivered for this loop. */
  reasoningState?: ConversationReasoningState;
  result?: ConversationLoopResult;
  /** llm_turn only: text and thinking in visible order, sharing one display sequence with tool calls. */
  items?: ConversationLoopItem[];
  toolCalls: ConversationToolCall[];
  startedAt: number;
  completedAt?: number;
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
  profileId?: string;
  role: ConversationRole;
  agentId?: AgentRole;
  content: string;
  status?: ConversationMessageStatus;
  /** Stopped assistant messages: who stopped the turn, so a stop at app shutdown is not shown as the person's Stop. */
  stopCause?: TurnStopCause;
  updatedAt?: number;
  workTrace?: ConversationWorkTrace | null;
  /** The stored process record does not match the current shape, so it is not shown. */
  workTraceDiscarded?: boolean;
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
  /** Turn-end continue actions from frozen profile handoffs whose surface is `turn-end`. */
  handoffSuggestions?: PlanReviewHandoffSuggestion[];
  /** User messages only: the reviewed plan this message executes or revises, verified by main at send. */
  planReference?: import('./planReview').ConversationPlanReference;
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

interface ConversationAttachmentStagePathItem {
  sourcePath: string;
  fileName?: string;
}

interface ConversationAttachmentStageBytesItem {
  fileName: string;
  mimeType?: string | null;
  bytesBase64: string;
}

export type ConversationAttachmentStageItem =
  ConversationAttachmentStagePathItem | ConversationAttachmentStageBytesItem;

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

export type AttachmentOwner =
  | { scope: 'staging'; stagingId: string; composerScopeKey: string }
  | { scope: 'session'; attachmentId: string; sessionId: string };

export interface ConversationAccessAttachmentRequest {
  owner: AttachmentOwner;
  action: 'preview' | 'open' | 'reveal';
}

export type ConversationAccessAttachmentResult =
  | { kind: 'image'; dataUrl: string }
  | { kind: 'markdown'; source: string }
  | { kind: 'opened' | 'revealed' }
  | { kind: 'error'; code: 'unavailable' | 'denied' | 'tooLarge' | 'unsupported' | 'openFailed' | 'revealFailed' };

export interface ConversationAttachmentInput {
  material?: import('@shared/types/materialContext').MaterialContext;
  sourcePath: string;
  fileName: string;
  mimeType?: string | null;
  size?: number | null;
  stagingId?: string;
}

interface ConversationErrorViewModel {
  code: string;
  message: string;
  technicalMessage?: string;
}

interface ConversationUiHints {
  highlightProjectPicker?: boolean;
  highlightSettingsRoute?: boolean;
}

interface ConversationExecutionTransition {
  action: 'none' | 'started_run';
  runId?: string;
  sessionId?: string;
}

export interface ConversationSendRequest {
  planReference?: import('./planReview').PlanReferenceRequest;
  requestId: string;
  projectId?: string | null;
  sessionId?: string | null;
  currentRunId?: string | null;
  replayDeviceId?: string | null;
  agentId?: string | null;
  profileId?: string | null;
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

/**
 * What a stop request did. `success: false` only means no turn or preparing request matched (`no-active-turn`);
 * a stop that fails rejects with its AppError like any other call.
 */
export type ConversationCancelActiveTurnResult =
  | {
      success: true;
      phase: 'preparing' | 'committing' | 'running';
      cancelledRequestId?: string;
      cancelledTurnId?: string;
    }
  | { success: false; reason: 'no-active-turn' };

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
  required?: boolean;
}

export interface ConversationAskUserAnswer {
  questionId: string;
  answer: string;
  selectedOptionId?: string;
  responseKind?: 'answered' | 'unknown' | 'skipped';
}

export interface ConversationAnswerUserInputRequest {
  sessionId?: string | null;
  turnId: string;
  toolCallId: string;
  answers: ConversationAskUserAnswer[];
}

export interface ConversationAnswerToolApprovalRequest {
  sessionId?: string | null;
  turnId: string;
  approvalId: string;
  approved: boolean;
}

export type {
  ConversationAnswerPlanReviewRequest,
  ConversationAnswerPlanReviewResult,
  ConversationPlanReview,
  PlanReviewDecision,
  PlanReviewHandoffSuggestion,
} from './planReview';

export interface ConversationTurnResult {
  requestId: string;
  session: SessionRecordSnapshot | null;
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

interface ConversationMessagePatchedEvent {
  type: 'message_patched';
  sessionId: string;
  turnId: string;
  message: ConversationMessage;
}

interface ConversationMessageCompletedEvent {
  type: 'message_completed';
  sessionId: string;
  turnId: string;
  message: ConversationMessage;
}

interface ConversationMessageErroredEvent {
  type: 'message_errored';
  sessionId: string;
  turnId: string;
  message: ConversationMessage;
}

/**
 * A streaming update of one message as the change since the previous update of the same message
 * (`src/shared/conversation/messageDelta.ts`). Main sends these instead of whole-message `message_patched` events;
 * the renderer rebuilds the message, and asks for `conversation:getMessageSnapshot` when it missed one.
 */
interface ConversationMessageDeltaEvent {
  type: 'message_delta';
  sessionId: string;
  turnId: string;
  delta: ConversationMessageDelta;
}

interface ConversationRunLinkedEvent {
  type: 'run_linked';
  sessionId: string;
  turnId: string;
  runId: string;
}

interface ConversationAgentEvent {
  type: 'agent_event';
  sessionId: string;
  turnId: string;
  event: AgentEvent;
}

export type ConversationStreamEvent =
  | ConversationMessagePatchedEvent
  | ConversationMessageCompletedEvent
  | ConversationMessageErroredEvent
  | ConversationMessageDeltaEvent
  | ConversationRunLinkedEvent
  | ConversationAgentEvent;
