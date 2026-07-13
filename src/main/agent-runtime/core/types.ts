/**
 * Agent Runtime 核心类型系统。
 *
 * 该文件定义了 Agent Runtime 内部使用的统一类型，
 * 与上层 `@shared/types/*` 中面向 IPC / UI 的协议类型分层独立：
 * - 这里的 `Message`、`AssistantMessage` 等描述 Provider/Runtime 之间的契约。
 * - `@shared/types/llm` 等仍负责 main ↔ renderer 的事件协议。
 *
 * 任何对外暴露给渲染层或 IPC 的事件，需要在 IPC 层做一次显式映射，
 * 不要把这里的类型直接透传出去。
 */

// =====================================================================
// 内容块（ContentBlock）
// =====================================================================

/** 纯文本内容块。 */
export interface TextContent {
  type: 'text';
  text: string;
}

export type ThinkingArtifactKind = 'summary' | 'raw' | 'opaque' | 'unknown';

export type ThinkingArtifactVisibility = 'summary' | 'raw-collapsed' | 'hidden';

export type ThinkingArtifactReplayPolicy = 'none' | 'provider-artifact' | 'openai-reasoning-content';

export type ThinkingArtifactSource =
  | 'openai-responses-summary'
  | 'openai-responses-encrypted'
  | 'anthropic-thinking'
  | 'anthropic-redacted-thinking'
  | 'openai-compatible-raw'
  | 'openrouter-raw'
  | 'gemini-raw'
  | 'ollama-raw'
  | 'unknown';

export interface ProviderReasoningArtifact {
  providerId: string;
  modelId?: string;
  protocol?: string;
  type: string;
  id?: string;
  encryptedContent?: string;
  signature?: string;
  data?: string;
  raw?: Record<string, unknown>;
}

export interface ThinkingContent {
  type: 'thinking';
  text?: string;
  kind: ThinkingArtifactKind;
  source: ThinkingArtifactSource;
  visibility: ThinkingArtifactVisibility;
  replayPolicy: ThinkingArtifactReplayPolicy;
  artifact?: ProviderReasoningArtifact;
}

/** 图像内容块，使用 base64 编码。 */
export interface ImageContent {
  type: 'image';
  /** base64 编码的图像数据，不含 data URI 前缀。 */
  data: string;
  /** 图像 MIME 类型，例如 `image/png`。 */
  mimeType: string;
}

/**
 * 工具调用内容块。
 *
 * 注意：与 `@shared/types/llm` 中的 `ToolCall` 不是同一类型，
 * 该类型属于 Agent Runtime 内部契约。
 */
export interface ToolCall {
  type: 'toolCall';
  /** 工具调用的唯一 id（由 Provider 或 Runtime 分配）。 */
  id: string;
  /** 被调用的工具名。 */
  name: string;
  /** 已解析的参数对象。 */
  arguments: Record<string, unknown>;
}

/** 任意内容块的联合类型。 */
export type ContentBlock = TextContent | ThinkingContent | ImageContent | ToolCall;

// =====================================================================
// 消息（Message）
// =====================================================================

/** 用户消息：可以是纯文本或文本/图像内容块数组。 */
export interface UserMessage {
  role: 'user';
  content: string | (TextContent | ImageContent)[];
  /** Unix 毫秒时间戳。 */
  timestamp: number;
}

/** 助手消息：包含文本、思考、工具调用等内容块。 */
export interface AssistantMessage {
  role: 'assistant';
  content: (TextContent | ThinkingContent | ToolCall)[];
  /** 模型 id（与 `Model.id` 对应）。 */
  model: string;
  /** Provider id（与 `Model.provider` 对应）。 */
  provider: string;
  /** Token 使用统计。 */
  usage: Usage;
  /** 助手消息结束的原因。 */
  stopReason: StopReason;
  /** Unix 毫秒时间戳。 */
  timestamp: number;
}

/** 工具调用结果消息。 */
export interface ToolResultMessage {
  role: 'toolResult';
  /** 对应 `ToolCall.id`。 */
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
  /** Provider 上报的 cache read tokens；未提供时缺省。 */
  cacheReadTokens?: number;
  /** Provider 上报的 cache write / creation tokens；未提供时缺省。 */
  cacheWriteTokens?: number;
  /** Provider 上报的 reasoning tokens；未提供时缺省。 */
  reasoningTokens?: number;
  /** 可选成本信息（单位：美元）。 */
  cost?: {
    input: number;
    output: number;
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
}

/**
 * 简化的 JSON Schema 定义。
 *
 * 仅覆盖 Agent Runtime 验证需要用到的字段，未列出的字段允许通过索引签名透传。
 */
export interface JsonSchema {
  type: string;
  properties?: Record<string, JsonSchema & { description?: string }>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
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
export interface ProviderCapabilities {
  streaming: boolean;
  nativeToolCalling: boolean;
  structuredOutput: boolean;
  vision: boolean;
  reasoning: boolean;
  parallelToolCalls: boolean;
}

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
  | { type: 'text_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'text_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'text_end'; contentIndex: number; content: string; partial: AssistantMessage }
  | { type: 'thinking_start'; contentIndex: number; thinking: ThinkingContent; partial: AssistantMessage }
  | { type: 'thinking_delta'; contentIndex: number; delta: string; thinking: ThinkingContent; partial: AssistantMessage }
  | { type: 'thinking_end'; contentIndex: number; content: string; thinking: ThinkingContent; partial: AssistantMessage }
  | { type: 'toolcall_start'; contentIndex: number; partial: AssistantMessage }
  | { type: 'toolcall_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
  | { type: 'toolcall_end'; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
  | { type: 'done'; reason: StopReason; message: AssistantMessage }
  | { type: 'error'; error: Error; message: AssistantMessage };

// =====================================================================
// Agent 事件（AgentEvent）
// =====================================================================

/** Agent 调度器/Runtime 层面的事件。 */
export type AgentEvent =
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
  | { type: 'compaction'; summary: string }
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

import type { ReasoningVisibility } from '@shared/types/agentRuntime';
import type { ResolvedReasoningSelection } from '@shared/types/modelCapability';
import type { RequestPlan } from '@shared/types/providerCapability';

/** 调用 Provider 流式生成时的可选参数。 */
export interface StreamOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  reasoning?: ResolvedReasoningSelection;
  /** 路由能力解析出的 reasoning 可见性；summary-events 时请求 provider 侧摘要 thinking。 */
  reasoningVisibility?: ReasoningVisibility;
  /** 用于中止本次生成的信号。 */
  signal?: AbortSignal;
  firstChunkTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
  requestTimeoutMs?: number;
  /** 覆盖 Provider 默认 API key。 */
  apiKey?: string;
  /** 覆盖 Provider 默认 baseUrl。 */
  baseUrl?: string;
  /** Closed, secret-free wire contract compiled by RequestPlanner. */
  requestPlan?: RequestPlan;
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
