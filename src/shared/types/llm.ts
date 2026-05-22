/**
 * LLM Types - LLM集成相关类型定义
 */

import type { AgentRole } from './agent';
import type { LlmProviderAuthMode, LlmProviderId, LlmProviderKind } from './settings';

// 内容块类型
export type ContentBlockType = 'text' | 'image' | 'tool_use' | 'tool_result';

// 内容块
export interface ContentBlock {
  type: ContentBlockType;
  text?: string;
  source?: {
    type: string;
    media_type: string;
    data: string;
  };
  tool_use_id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
}

// LLM消息
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
  name?: string;
}

// 工具定义
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
}

// 工具调用
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMToolCallDelta {
  id: string;
  name?: string;
  argumentsText?: string;
}

// LLM请求
export interface LLMRequest {
  messages: LLMMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: ToolDefinition[];
  responseFormat?: 'json_object';
  stream?: boolean;
  signal?: AbortSignal;
}

// LLM响应
export interface LLMResponse {
  id: string;
  model: string;
  content: string | ContentBlock[];
  toolCalls?: ToolCall[];
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
}

export type LLMStreamEvent =
  | {
      type: 'text-delta';
      text: string;
    }
  | {
      type: 'tool-call-delta';
      toolCall: LLMToolCallDelta;
    }
  | {
      type: 'done';
    }
  | {
      type: 'error';
      error: string;
    };

// LLM Provider接口
export interface LLMProvider {
  name: string;
  chat(request: LLMRequest): Promise<LLMResponse>;
  streamChat(
    request: LLMRequest,
    onChunk: (chunk: LLMStreamEvent) => void
  ): Promise<LLMResponse>;
  isAvailable(): Promise<boolean>;
  getModels(): string[];
}

// LLM配置
export interface LLMProviderConfig {
  id: LlmProviderId;
  kind: LlmProviderKind;
  authMode?: LlmProviderAuthMode;
  label: string;
  enabled: boolean;
  apiKey: string;
  baseUrl?: string;
  models: string[];
  docsUrl?: string;
}

export interface LLMAgentRouteConfig {
  agentId: AgentRole;
  providerId: LlmProviderId;
  modelId: string;
}

export interface LLMConfig {
  providers: LLMProviderConfig[];
  agentRoutes: LLMAgentRouteConfig[];
}

// 流式响应回调
export type StreamCallback = (chunk: LLMStreamEvent) => void;
