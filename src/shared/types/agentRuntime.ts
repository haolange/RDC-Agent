import type { AdmissionCheck, PermissionReviewVerdictKind, ToolApprovalEscalation } from '../constants/admissionChecks';
/**
 * Shared Agent Runtime event types for the IPC contract.
 *
 * Main's loop events are translated into this shared shape by
 * src/main/agent-runtime/AgentEventBridge.ts before conversation and renderer projection.
 */
import type { AgentRole } from './agent';
import type { ProviderOutputRef, ThinkingArtifact } from './reasoning';
import type { CapabilityState } from './providerCapability';
import type { ProviderReasoningContract } from './rdcRuntime';
import type {
  ConversationAskUserAnswer,
  ConversationAskUserQuestion,
  ConversationDiagnosticSeverity,
  ConversationLoopStopReason,
  ConversationTaskSnapshotItem,
  ConversationTaskStatus,
} from './conversation';
import type { ConversationPlanReview, PlanReviewDecision } from './planReview';
import type { LlmProviderId } from './settings';
import type { ToolCall, ToolCallResult } from './tool';

export type ToolCallingMode = 'native-structured' | 'text-only' | 'disabled';

export type ReasoningVisibility = 'summary-events' | 'unknown-events' | 'hidden' | 'none';

/** 协议级 reasoning 交付语义：驱动 provider 请求参数与 Work Process 展示模式。 */
export type ReasoningDelivery = 'none' | 'summary-only' | 'stream-full' | 'hidden';

export interface AgentRouteCapability {
  providerId: LlmProviderId;
  modelId: string;
  toolCallingMode: ToolCallingMode;
  /** Provider stream visibility derived from reasoningDelivery for route execution. */
  reasoningVisibility: ReasoningVisibility;
  reasoningDelivery: ReasoningDelivery;
  reasoningContract: ProviderReasoningContract;
  supportsStreaming: boolean;
  supportsToolResults: boolean;
  /** Catalog/runtime evidence for native tool calling. Independent from execution mode. */
  toolCallingEvidence: CapabilityState['state'];
  /** True when tool use is fail-open because catalog evidence is not yet conclusive. */
  toolCallingUnverified: boolean;
  visionInputMode: 'native' | 'disabled';
  structuredOutputMode: 'native' | 'prompt-fallback';
}

interface AgentRunStartedPayload {
  profileId: string;
  providerId: string;
  modelId: string;
  toolAllowlist: string[];
  routeCapability?: AgentRouteCapability;
}

interface AgentAssistantDeltaPayload {
  text: string;
  phase?: 'commentary' | 'final_answer';
  providerOutputRef: ProviderOutputRef;
}

interface AgentAssistantThinkingPayload {
  text: string;
  thinking?: ThinkingArtifact;
  providerOutputRef: ProviderOutputRef;
}

export interface AgentAssistantCompletedPayload {
  text: string;
  textItems?: Array<{ text: string; phase?: 'commentary' | 'final_answer'; providerOutputRef: ProviderOutputRef }>;
  thinking?: ThinkingArtifact[];
  providerOutputRefs?: ProviderOutputRef[];
  stopReason?: ConversationLoopStopReason;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

interface AgentToolRequestedPayload {
  toolCall: ToolCall;
  providerOutputRef: ProviderOutputRef;
}

interface AgentToolStartedPayload {
  permissionState?: import('./runtimePermission').RuntimePermissionState;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

/**
 * Where a running RDC operation stands, from its own progress stream. `operation` and `nativeCall` are technical
 * names: they leave the product surface only through copy diagnostics. `lastProgressAt` moves with progress and
 * native-call frames, never with heartbeats, so the renderer can tell a quiet operation from a busy one.
 */
export interface RdcOperationProgress {
  operation: string;
  state: 'queued' | 'running';
  stage: string | null;
  progressPct: number | null;
  nativeCall: string | null;
  startedAt: number;
  lastProgressAt: number;
}

/** A running tool's progress: ephemeral, streamed to the renderer only, never persisted or shown to the model. */
export interface AgentToolProgressPayload {
  toolCallId: string;
  toolName: string;
  progress: RdcOperationProgress;
}

interface AgentToolCompletedPayload {
  toolCallId: string;
  toolName: string;
  result: ToolCallResult;
}

interface AgentToolDeniedPayload {
  toolCallId: string;
  toolName: string;
  reason: string;
  result?: ToolCallResult;
}

interface AgentTaskEventPayload {
  taskId: string;
  title: string;
  status?: ConversationTaskStatus;
  statusReason?: string;
  /** The session's projected Task list after this change. */
  snapshot?: ConversationTaskSnapshotItem[];
}

export interface AgentApprovalEventPayload {
  reviewMethod?: 'rule' | 'model';
  /** Auto-review only: the settled verdict and the admission checks it named. */
  verdict?: PermissionReviewVerdictKind;
  failedChecks?: AdmissionCheck[];
  /** A user approval the auto-review handed over because it could not decide, with the checks it could not establish. */
  escalatedFrom?: ToolApprovalEscalation;
  errorCode?: string;
  delegatedRequest?: { executionId: string; childSessionId: string; turnId: string };
  approvalId: string;
  title: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reason?: string;
  kind?: 'tool' | 'ask_user' | 'run_start' | 'plan_review';
  toolCallId?: string;
  toolName?: string;
  risk?: 'low' | 'medium' | 'high';
  reviewer?: 'auto_review';
  question?: string;
  options?: string[];
  questions?: ConversationAskUserQuestion[];
  answers?: ConversationAskUserAnswer[];
  planReview?: ConversationPlanReview;
  decision?: PlanReviewDecision;
  answer?: unknown;
}

interface AgentDiagnosticPayload {
  code: string;
  severity: ConversationDiagnosticSeverity;
  message: string;
  technicalMessage?: string;
  /** Present only when a runtime Hook belongs to a concrete tool call. */
  toolCallId?: string;
  /** Recovery diagnostics: started while retrying, completed after success. */
  phase?: 'started' | 'completed';
}

interface AgentRunFinalPayload {
  status: 'complete' | 'failed' | 'cancelled';
  text?: string;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/** Automatic compaction progress; one compaction reports `running` and then `complete` or `error`. */
export interface AgentContextCompactedPayload {
  summary: string;
  usage?: { inputTokens: number; outputTokens: number };
  compactionId?: string;
  status?: 'running' | 'complete' | 'error';
  tokensBefore?: number;
  tokensAfter?: number;
  sourceUri?: string;
  sourceHash?: string;
}

/** The payload each runtime event type carries; the event union below is derived from it. */
export interface AgentEventPayloadMap {
  'run.started': AgentRunStartedPayload;
  'assistant.delta': AgentAssistantDeltaPayload;
  'assistant.text_end': AgentAssistantDeltaPayload;
  'assistant.thinking_delta': AgentAssistantThinkingPayload;
  'assistant.thinking_end': AgentAssistantThinkingPayload;
  'assistant.completed': AgentAssistantCompletedPayload;
  'tool.requested': AgentToolRequestedPayload;
  'tool.started': AgentToolStartedPayload;
  'tool.progress': AgentToolProgressPayload;
  'tool.completed': AgentToolCompletedPayload;
  'tool.denied': AgentToolDeniedPayload;
  'task.created': AgentTaskEventPayload;
  'task.updated': AgentTaskEventPayload;
  'approval.requested': AgentApprovalEventPayload;
  'approval.answered': AgentApprovalEventPayload;
  diagnostic: AgentDiagnosticPayload;
  'run.completed': AgentRunFinalPayload;
  'run.failed': AgentRunFinalPayload;
  'run.cancelled': AgentRunFinalPayload;
  'context.compacted': AgentContextCompactedPayload;
}

export type AgentEventType = keyof AgentEventPayloadMap;

/** One runtime event of type `T`; `AgentEvent` is the union over every type. */
export interface AgentEventOf<T extends AgentEventType> {
  id: string;
  type: T;
  timestamp: number;
  runId?: string;
  turnId?: string;
  sessionId?: string | null;
  agentId?: AgentRole;
  payload: AgentEventPayloadMap[T];
}

/**
 * A runtime event as the conversation, the delegation trace and the renderer (`agent_event`) receive it, discriminated
 * by `type`. Main's loop events (`AgentLoopEvent`) are translated into it by src/main/agent-runtime/AgentEventBridge.ts.
 */
export type AgentEvent = { [T in AgentEventType]: AgentEventOf<T> }[AgentEventType];
