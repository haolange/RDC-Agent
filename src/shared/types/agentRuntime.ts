/**
 * Shared Agent Runtime event types for the IPC contract.
 *
 * Core runtime events are translated into this shared shape by
 * src/main/agent-runtime/AgentEventBridge.ts before renderer projection.
 */
import type { AgentRole } from './agent';
import type { LLMStreamEvent, ToolCall } from './llm';
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

export type AgentEventType =
  | 'run.started'
  | 'assistant.delta'
  | 'assistant.thinking_delta'
  | 'assistant.thinking_end'
  | 'assistant.completed'
  | 'tool.requested'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.denied'
  | 'task.created'
  | 'task.updated'
  | 'approval.requested'
  | 'approval.answered'
  | 'diagnostic'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'context.compacted'
  | 'subagent.started'
  | 'subagent.delta'
  | 'subagent.completed'
  | 'handoff.requested'
  | 'handoff.consumed'
  | 'handoff.cancelled';

export interface AgentEventBasePayload {
  [key: string]: unknown;
}

export interface AgentRunStartedPayload extends AgentEventBasePayload {
  profileId: string;
  providerId: string;
  modelId: string;
  toolAllowlist: string[];
}

export interface AgentAssistantDeltaPayload extends AgentEventBasePayload {
  text: string;
  providerOutputRef: ProviderOutputRef;
}

export interface AgentAssistantThinkingPayload extends AgentEventBasePayload {
  text: string;
  thinking?: ThinkingArtifact;
}

export interface AgentAssistantCompletedPayload extends AgentEventBasePayload {
  text: string;
  thinking?: ThinkingArtifact[];
  providerOutputRefs?: ProviderOutputRef[];
  stopReason?: ConversationLoopStopReason;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface AgentToolRequestedPayload extends AgentEventBasePayload {
  toolCall: ToolCall;
  providerOutputRef: ProviderOutputRef;
  streamEvent?: LLMStreamEvent;
}

export interface AgentToolStartedPayload extends AgentEventBasePayload {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface AgentToolCompletedPayload extends AgentEventBasePayload {
  toolCallId: string;
  toolName: string;
  result: ToolCallResult;
}

export interface AgentToolDeniedPayload extends AgentEventBasePayload {
  toolCallId: string;
  toolName: string;
  reason: string;
  result?: ToolCallResult;
}

export interface AgentTaskEventPayload extends AgentEventBasePayload {
  taskId: string;
  title: string;
  status?: 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';
  statusReason?: string;
  parentTaskId?: string;
}

export interface AgentApprovalEventPayload extends AgentEventBasePayload {
  delegatedRequest?: { executionId: string; childSessionId: string; turnId: string };
  approvalId: string;
  title: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reason?: string;
  kind?: 'tool' | 'ask_user' | 'run_start' | 'plan_review';
  toolCallId?: string;
  toolName?: string;
  question?: string;
  options?: string[];
  questions?: ConversationAskUserQuestion[];
  answers?: ConversationAskUserAnswer[];
  planReview?: ConversationPlanReview;
  decision?: PlanReviewDecision;
  answer?: unknown;
}

export interface AgentDiagnosticPayload extends AgentEventBasePayload {
  code: string;
  severity: ConversationDiagnosticSeverity;
  message: string;
  technicalMessage?: string;
  /** Recovery diagnostics: started while retrying, completed after success. */
  phase?: 'started' | 'completed';
}

export interface AgentRunFinalPayload extends AgentEventBasePayload {
  status: 'complete' | 'failed' | 'cancelled';
  text?: string;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface AgentContextCompactedPayload extends AgentEventBasePayload {
  summary: string;
}

/**
 * Subagent 事件 payload。
 *
 * 父 agent 通过 task/agent 工具派生子 agent 时，子 agent 的生命周期
 * 以 subagent.* 事件投影到父 trace（嵌套 block），不污染父 trace 的扁平 tool block。
 */
export interface AgentSubagentEventPayload extends AgentEventBasePayload {
  /** 子 agent 标识（子 context id）。 */
  subagentId: string;
  /** 子 agent profile。 */
  profile: string;
  /** 触发该子 agent 的父 toolCallId。 */
  parentToolCallId: string;
  /** subagent.started: 任务描述；subagent.delta: 增量文本；subagent.completed: 最终摘要。 */
  text?: string;
  /** subagent.completed 时的状态。 */
  status?: 'complete' | 'failed' | 'cancelled';
  /** 子 agent 内部 tool/loop 活动的结构化增量（subagent.delta 可选携带）。 */
  child?: AgentSubagentChildPayload;
}

export interface AgentSubagentChildPayload extends AgentEventBasePayload {
  id: string;
  kind: 'llm_turn' | 'tool';
  title: string;
  summary?: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  toolName?: string;
}

/**
 * Historical handoff event payload retained for old transcripts.
 * Live continue actions persist session.agentId through applyDeclaredHandoff.
 */
export interface AgentHandoffRequestedPayload extends AgentEventBasePayload {
  /** 源 profile。 */
  fromAgentId: string;
  /** 目标 profile。 */
  toProfile: string;
  toAgentId?: string;
  handoffId?: string;
  send?: boolean;
  /** 移交后注入的 prompt（缺省时从目标 profile handoffs 定义取）。 */
  prompt: string;
  /** handoff 标签。 */
  label?: string;
}

export interface AgentHandoffConsumedPayload extends AgentEventBasePayload {
  handoffId: string;
  fromAgentId: string;
  toAgentId: string;
  toProfile: string;
}

export interface AgentHandoffCancelledPayload extends AgentEventBasePayload {
  handoffId: string;
  fromAgentId: string;
  toAgentId: string;
  toProfile: string;
  cancelReason: string;
}

export type AgentEventPayload =
  | AgentRunStartedPayload
  | AgentAssistantDeltaPayload
  | AgentAssistantThinkingPayload
  | AgentAssistantCompletedPayload
  | AgentToolRequestedPayload
  | AgentToolStartedPayload
  | AgentToolCompletedPayload
  | AgentToolDeniedPayload
  | AgentTaskEventPayload
  | AgentApprovalEventPayload
  | AgentDiagnosticPayload
  | AgentRunFinalPayload
  | AgentContextCompactedPayload
  | AgentSubagentEventPayload
  | AgentHandoffRequestedPayload
  | AgentHandoffConsumedPayload
  | AgentHandoffCancelledPayload;

export interface AgentEvent {
  id: string;
  type: AgentEventType;
  timestamp: number;
  runId?: string;
  turnId?: string;
  sessionId?: string | null;
  agentId?: AgentRole;
  payload: AgentEventPayload;
}

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
