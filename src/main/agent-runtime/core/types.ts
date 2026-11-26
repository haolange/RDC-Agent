import type { RuntimePermissionState } from '@shared/types/runtimePermission';
import type { CompiledPromptCache } from '@shared/types/semanticContext';
import type { DerivedContextMessageRef } from '../context/structuredHandoff';
import type { PromptSegment } from '@shared/types/rdcRuntime';
import type { AssistantMessageDiagnostic } from './providerErrors';
import type { ToolCall } from '@shared/types/tool';

/**
 * Internal types for the provider/runtime boundary.
 * Renderer and IPC surfaces must receive explicit shared projections, never these objects directly.
 */

// =====================================================================
// Content blocks
// =====================================================================

export type ProviderOutputRef = import('@shared/types/reasoning').ProviderOutputRef;

export type ThinkingArtifactKind = import('@shared/types/reasoning').ThinkingArtifactKind;

export type ThinkingArtifactVisibility = import('@shared/types/reasoning').ThinkingArtifactVisibility;

export type ThinkingArtifactSource = import('@shared/types/reasoning').ThinkingArtifactSource;

export interface TextContent {
  type: 'text';
  text: string;
  phase?: 'commentary' | 'final_answer';
  providerOutputRef?: ProviderOutputRef;
}

export interface ThinkingContent {
  type: 'thinking';
  text?: string;
  kind: ThinkingArtifactKind;
  source: ThinkingArtifactSource;
  visibility: ThinkingArtifactVisibility;
  continuation?: ProviderContinuationArtifact;
  providerOutputRef?: ProviderOutputRef;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

/** A tool call as an assistant content block: the shared `ToolCall` plus what only main's loop reads. */
export interface ToolCallContent extends ToolCall {
  type: 'toolCall';
  /** The model's argument text when it was not a JSON object; `arguments` is then empty and the call is not run. */
  invalidArguments?: string;
  providerOutputRef?: ProviderOutputRef;
}

export type ContentBlock = TextContent | ThinkingContent | ImageContent | ToolCallContent;

// =====================================================================
// 消息（Message）
// =====================================================================

/** 用户消息：可以是纯文本或文本/图像内容块数组。 */
export interface UserMessage {
  role: 'user';
  content: string | (TextContent | ImageContent)[];
  /** Unix 毫秒时间戳。 */
  /** Typed derived context ownership; canonical transcript messages never set this field. */
  derivedContext?: DerivedContextMessageRef;
  timestamp: number;
}

/** 助手消息：包含文本、思考、工具调用等内容块。 */
export interface AssistantMessage {
  role: 'assistant';
  content: (TextContent | ThinkingContent | ToolCallContent)[];
  /** 模型 id（与 `Model.id` 对应）。 */
  model: string;
  /** Provider id（与 `Model.provider` 对应）。 */
  provider: string;
  /** Actual server response metadata; never inferred from the requested model/tier. */
  execution?: {
    modelId?: string;
    serviceTier?: string;
    reasoningEvents?: import('@shared/types/reasoning').ReasoningEventSummary;
  };
  /** Token 使用统计。 */
  usage: Usage;
  /** 助手消息结束的原因。 */
  stopReason: StopReason;
  /** Opaque provider-managed continuation state. Never projected to renderer or IPC. */
  providerState?: ProviderStateRef;
  /** Diagnostic entries attached on failure for error classification. */
  diagnostics?: AssistantMessageDiagnostic[];
  /** Unix 毫秒时间戳。 */
  timestamp: number;
}

/** 工具调用结果消息。 */
export interface ToolResultMessage {
  role: 'toolResult';
  /** 对应 `ToolCallContent.id`。 */
  toolCallId: string;
  /** 工具名（冗余存储，便于日志/追踪）。 */
  toolName: string;
  /** 工具返回的内容块（文本或图像）。 */
  content: (TextContent | ImageContent)[];
  /** 是否为错误结果。 */
  isError: boolean;
  /** Tool-specific structured details for transcript summaries. */
  details?: unknown;
  /** Unix 毫秒时间戳。 */
  timestamp: number;
}

/** Runtime 上下文中流转的消息联合类型。 */
export type Message = UserMessage | AssistantMessage | ToolResultMessage;

// =====================================================================
// 停止原因（StopReason）
// =====================================================================

/** 助手消息生成结束的原因。 */
export type StopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted' | 'refusal';

// =====================================================================
// Token / 成本
// =====================================================================

/** 一次推理的 token 使用与可选成本。 */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Provider-confirmed service speed for this request. */
  speed?: 'standard' | 'fast';
  /** Provider 上报的 cache read tokens；未提供时缺省。 */
  cacheReadTokens?: number;
  /** Provider 上报的 cache write / creation tokens；未提供时缺省。 */
  cacheWriteTokens?: number;
  /** Long-lived cache write tokens (e.g. Anthropic 1h TTL); subset of cacheWriteTokens. */
  cacheWriteLongTokens?: number;
  /**
   * Normalized cache hit tokens for this request (native or derived from cacheRead).
   * Omitted when the provider reported no cache telemetry.
   */
  cacheHitTokens?: number;
  /**
   * Normalized cache miss tokens for this request (native or derived).
   * Omitted when the provider reported no cache telemetry.
   */
  cacheMissTokens?: number;
  /** Provider 上报的 reasoning tokens；未提供时缺省。 */
  reasoningTokens?: number;
  /** 可选成本信息（单位：美元）。 */
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
    total: number;
  };
}

// =====================================================================
// 上下文（Context）
// =====================================================================

/** 一次模型调用的上下文输入。 */
export interface Context {
  /** 系统提示词。 */
  systemPrompt?: string;
  /** PromptPlan-owned segments used to compile stable provider cache blocks. */
  systemPromptSegments?: PromptSegment[];
  /** 历史消息序列。 */
  messages: Message[];
  /** 可用工具集合。 */
  tools?: ToolDefinition[];
}

// =====================================================================
// 工具定义 / JSON Schema
// =====================================================================

/** 工具定义。 */
export interface ToolDefinition {
  /** 工具名（在一组 tools 内唯一）。 */
  name: string;
  /** 给模型阅读的工具描述。 */
  description: string;
  /** 入参 JSON Schema。 */
  parameters: JsonSchema;
  /** Whether repeating the same call is a valid wait-for-state-change poll. */
  pollable?: boolean;
}

/**
 * 简化的 JSON Schema 定义。
 *
 * 仅覆盖 Agent Runtime 验证需要用到的字段，未列出的字段允许通过索引签名透传。
 */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema & { description?: string }>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  additionalProperties?: boolean | JsonSchema;
  default?: unknown;
  [key: string]: unknown;
}

// =====================================================================
// 模型与 Provider 能力
// =====================================================================

/** Provider 适配的 API 协议族。 */
export type ModelApi =
  | 'openai-compatible'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-interactions'
  | 'google-gemini'
  | 'ollama'
  | (string & {});

/** 模型描述。 */
export interface Model {
  /** 模型唯一 id。 */
  id: string;
  /** 展示名。 */
  name: string;
  /** 所属 Provider id。 */
  provider: string;
  /** API 协议族标识。 */
  api: ModelApi;
  /** 上下文窗口大小（token）。 */
  contextWindow: number;
  /** 单次输出最大 token。 */
  maxTokens: number;
  /** 是否支持 reasoning。 */
  reasoning: boolean;
  /** 是否支持视觉输入。 */
  vision: boolean;
  /** 计费信息（单位：美元 / 百万 token）。 */
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
}

/** Provider 的能力声明。 */
// =====================================================================
// 流式事件（AssistantMessageEvent）
// =====================================================================

/**
 * 助手消息生成过程中的细粒度流式事件。
 *
 * 所有事件都携带 `partial`（截至当前事件已积累的助手消息），
 * 便于消费者直接渲染当前可见状态而无需自行重建。
 */
export type AssistantMessageEvent =
  | { type: 'start'; partial: AssistantMessage }
  | { type: 'text_start'; contentIndex: number; providerOutputRef: ProviderOutputRef; partial: AssistantMessage }
  | {
      type: 'text_delta';
      contentIndex: number;
      delta: string;
      phase?: TextContent['phase'];
      providerOutputRef: ProviderOutputRef;
      partial: AssistantMessage;
    }
  | {
      type: 'text_end';
      contentIndex: number;
      content: string;
      phase?: TextContent['phase'];
      providerOutputRef: ProviderOutputRef;
      partial: AssistantMessage;
    }
  | {
      type: 'thinking_start';
      contentIndex: number;
      thinking: ThinkingContent;
      providerOutputRef: ProviderOutputRef;
      partial: AssistantMessage;
    }
  | {
      type: 'thinking_delta';
      contentIndex: number;
      delta: string;
      thinking: ThinkingContent;
      providerOutputRef: ProviderOutputRef;
      partial: AssistantMessage;
    }
  | {
      type: 'thinking_end';
      contentIndex: number;
      content: string;
      thinking: ThinkingContent;
      providerOutputRef: ProviderOutputRef;
      partial: AssistantMessage;
    }
  | { type: 'toolcall_start'; contentIndex: number; providerOutputRef: ProviderOutputRef; partial: AssistantMessage }
  | {
      type: 'toolcall_delta';
      contentIndex: number;
      delta: string;
      providerOutputRef: ProviderOutputRef;
      partial: AssistantMessage;
    }
  | {
      type: 'toolcall_end';
      contentIndex: number;
      toolCall: ToolCallContent;
      providerOutputRef: ProviderOutputRef;
      partial: AssistantMessage;
    }
  | { type: 'done'; reason: StopReason; message: AssistantMessage }
  | { type: 'error'; error: Error; message: AssistantMessage };

// =====================================================================
// Agent loop 事件（AgentLoopEvent）
// =====================================================================

/**
 * Agent loop 层面的事件，只在主进程内流转；AgentEventBridge 把它翻译成跨进程的 shared `AgentEvent`。
 */
export type AgentLoopEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end'; messages: Message[] }
  | { type: 'turn_start'; turn: number }
  | {
      type: 'turn_end';
      turn: number;
      message: AssistantMessage;
      toolResults?: ToolResultMessage[];
    }
  | { type: 'message_start'; message: Message }
  | {
      type: 'message_update';
      assistantMessageEvent: AssistantMessageEvent;
      message: AssistantMessage;
    }
  | { type: 'message_end'; message: Message }
  | {
      type: 'tool_execution_start';
      permissionState?: RuntimePermissionState;
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | {
      type: 'tool_execution_update';
      toolCallId: string;
      toolName: string;
      partialResult: unknown;
    }
  | {
      type: 'tool_execution_end';
      toolCallId: string;
      toolName: string;
      result: ToolResultMessage;
      durationMs: number;
    }
  | {
      type: 'approval_requested';
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
    }
  | { type: 'approval_resolved'; toolCallId: string; approved: boolean }
  | ({ type: 'compaction' } & AgentContextCompactedPayload)
  | {
      type: 'diagnostic';
      code: string;
      severity: 'info' | 'warning' | 'error';
      message: string;
      technicalMessage?: string;
      phase?: 'started' | 'completed';
    }
  | { type: 'error'; error: Error; aborted?: boolean };

// =====================================================================
// Stream 选项
// =====================================================================

import type { AgentContextCompactedPayload, ReasoningVisibility } from '@shared/types/agentRuntime';
import type { ResolvedReasoningSelection } from '@shared/types/modelCapability';
import type { RequestPlan } from '@shared/types/providerCapability';
import type { ProviderContractBundle } from '@shared/provider-catalog/modelManifestSchema';
import type { ExecutionIdentity } from '@shared/types/providerCapability';
import type { ContinuationArtifactMetadata } from '@shared/types/reasoning';

/** 调用 Provider 流式生成时的可选参数。 */
export interface StreamOptions {
  /** Explicit one-shot capability check; no account retry after a failed request. */
  capabilityProbe?: boolean;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  reasoning?: ResolvedReasoningSelection;
  /** 路由能力解析出的 reasoning 可见性；summary-events 时请求 provider 侧摘要 thinking。 */
  reasoningVisibility?: ReasoningVisibility;
  /** 用于中止本次生成的信号。 */
  signal?: AbortSignal;
  /** Silence allowed from request dispatch to the first chunk (connect, headers and first bytes); see `providerFirstByteTimeoutMs`. */
  firstChunkTimeoutMs?: number;
  /** Silence allowed between chunks once the stream has started; there is no total limit while chunks keep coming. */
  streamIdleTimeoutMs?: number;
  /** 覆盖 Provider 默认 API key。 */
  apiKey?: string;
  /** 覆盖 Provider 默认 baseUrl。 */
  baseUrl?: string;
  /** Closed, secret-free wire contract compiled by RequestPlanner. */
  requestPlan: RequestPlan;
  /** Opaque main-process lease created by send preflight; never persisted or exposed to renderer. */
  /** Provider-specific cache behavior compiled from the prompt prefix and provider contract. */
  promptCache?: CompiledPromptCache;
  credentialHandle?: string;
}

// =====================================================================
// AgentMessage（应用层扩展）
// =====================================================================

/**
 * 自定义应用层消息。
 *
 * 允许上层 Agent 在标准 `Message` 之外携带 UI 专用消息，
 * `role` 必须能与标准 role（user / assistant / toolResult）区分。
 */
export interface CustomAgentMessage {
  role: string;
  timestamp: number;
  [key: string]: unknown;
}

/** Runtime 与应用层共同消费的消息类型。 */
export type AgentMessage = Message | CustomAgentMessage;

export interface ProviderStateRef {
  carrier: ProviderContractBundle['state']['carrier'];
  value: string;
  origin: ExecutionIdentity;
  originFingerprint: string;
  integrityHash: string;
}

export interface ProviderContinuationArtifact extends ContinuationArtifactMetadata {
  origin: ExecutionIdentity;
  id?: string;
  encryptedContent?: string;
  signature?: string;
  thoughtSignature?: string;
  redactedContent?: string;
  opaqueState?: string;
  reasoningContent?: string;
  raw?: Record<string, unknown>;
  containerBinding?: {
    providerBlockKey: string;
    itemId?: string;
    toolCallIds?: string[];
  };
}
