/**
 * Shared Agent Runtime event types for the IPC contract.
 *
 * Main's loop events are translated into this shared shape by
 * src/main/agent-runtime/AgentEventBridge.ts before conversation and renderer projection.
 */
import type { AgentRole } from './agent';
import type { ToolCall } from './llm';
import type { MCPTransport } from './mcp';
import type { AgentPromptProfile, AgentToolPolicy } from './profile';
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
import type { LlmProviderAuthMode, LlmProviderId, LlmProviderProtocol } from './settings';
import type { ToolCallResult } from './tool';

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

export interface AgentRunStartedPayload {
  profileId: string;
  providerId: string;
  modelId: string;
  toolAllowlist: string[];
  routeCapability?: AgentRouteCapability;
}

export interface AgentAssistantDeltaPayload {
  text: string;
  phase?: 'commentary' | 'final_answer';
  providerOutputRef: ProviderOutputRef;
}

export interface AgentAssistantThinkingPayload {
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

export interface AgentToolRequestedPayload {
  toolCall: ToolCall;
  providerOutputRef: ProviderOutputRef;
}

export interface AgentToolStartedPayload {
  permissionState?: import('./runtimePermission').RuntimePermissionState;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface AgentToolCompletedPayload {
  toolCallId: string;
  toolName: string;
  result: ToolCallResult;
}

export interface AgentToolDeniedPayload {
  toolCallId: string;
  toolName: string;
  reason: string;
  result?: ToolCallResult;
}

export interface AgentTaskEventPayload {
  taskId: string;
  title: string;
  status?: ConversationTaskStatus;
  statusReason?: string;
  /** The session's projected Task list after this change. */
  snapshot?: ConversationTaskSnapshotItem[];
}

export interface AgentApprovalEventPayload {
  reviewMethod?: 'rule' | 'model';
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

export interface AgentDiagnosticPayload {
  code: string;
  severity: ConversationDiagnosticSeverity;
  message: string;
  technicalMessage?: string;
  /** Present only when a runtime Hook belongs to a concrete tool call. */
  toolCallId?: string;
  /** Recovery diagnostics: started while retrying, completed after success. */
  phase?: 'started' | 'completed';
}

export interface AgentRunFinalPayload {
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

export interface AgentRuntimeSkillDescriptor {
  id: string;
  name: string;
  label: string;
  description: string;
  source: 'builtin' | 'user' | 'project';
  enabledByDefault: boolean;
  path?: string;
  parameters?: Record<string, unknown>;
}

export type ModelProviderBackendKind =
  | 'native'
  | 'openai-compatible'
  | 'local'
  | 'account-oauth';

export interface ModelProviderCapabilityMatrix {
  providerId: LlmProviderId;
  protocol: LlmProviderProtocol;
  authMode: LlmProviderAuthMode;
  backendKind: ModelProviderBackendKind;
  streaming: boolean;
  nativeToolCalling: boolean;
  structuredOutput: boolean;
  vision: boolean;
  reasoning: boolean;
  parallelToolCalls: boolean;
  oauth: boolean;
  local: boolean;
  toolCallFormat: 'openai-chat-completions' | 'openai-responses' | 'anthropic-messages' | 'google-gemini' | 'none';
  structuredReliability: 'native' | 'prompted' | 'unsupported';
}

export interface ModelTurnEvent {
  providerId: LlmProviderId;
  modelId: string;
  type: 'started' | 'delta' | 'tool_call' | 'completed' | 'failed';
  text?: string;
  toolCall?: ToolCall;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  error?: string;
}

export interface AgentRuntimeProfileDescriptor extends AgentPromptProfile {
  runtimePolicy: AgentToolPolicy;
  providerRoute?: {
    providerId: LlmProviderId;
    modelId: string;
  };
  maxTurns?: number;
  maxToolIterations?: number;
}

export interface AgentRuntimeTaskDescriptor {
  id: string;
  title: string;
  status: 'pending' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled';
  ownerAgentId: AgentRole;
  dependsOn?: string[];
}

export interface AgentRuntimeTaskGraphDescriptor {
  id: string;
  runId: string;
  profileId: string;
  execution: 'serial';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  tasks: AgentRuntimeTaskDescriptor[];
}

export interface AgentRuntimeMcpDescriptor {
  id: string;
  name: string;
  description: string;
  transport: MCPTransport;
  enabledByDefault: boolean;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  scope?: 'builtin' | 'user' | 'project';
  sourcePath?: string;
  sourceHash?: string;
  /** Project MCP requires hash-bound trust before connect. */
  needsRetrust?: boolean;
  /** Same-id project attempted to change user executable fields. */
  executableOverrideRejected?: boolean;
  projectRealpath?: string;
  descriptorHash?: string;
  blockedReason?: string;
}

export interface AgentRuntimeCatalog {
  skills: AgentRuntimeSkillDescriptor[];
  mcpServers: AgentRuntimeMcpDescriptor[];
}
