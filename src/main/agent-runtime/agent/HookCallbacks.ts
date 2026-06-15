import type { ToolCall, ToolResultMessage, UserMessage } from '../core/types';

/** 各钩子的回调签名（17 种）。 */
export interface HookCallbacks {
  SessionStart: (context: { sessionId: string; agentId: string }) => Promise<void>;
  SessionEnd: (context: { sessionId: string; totalTurns: number; reason: string }) => Promise<void>;
  UserPromptSubmit: (prompt: string | UserMessage) => Promise<void | string>;
  AssistantResponseStart: (context: { turn: number; modelId: string }) => Promise<void>;
  AssistantResponseEnd: (context: { turn: number; modelId: string; usage?: { inputTokens: number; outputTokens: number } }) => Promise<void>;
  /** 返回非空 string 则阻止该工具执行（作为错误消息）。 */
  PreToolUse: (context: { toolName: string; toolCall: ToolCall; turn: number }) => Promise<void | string>;
  PostToolUse: (context: { toolName: string; toolCall: ToolCall; result: ToolResultMessage; turn: number }) => Promise<void>;
  PostToolUseFailure: (context: { toolName: string; toolCall: ToolCall; error: Error; turn: number }) => Promise<void>;
  PermissionRequest: (context: { toolName: string; toolCall: ToolCall; reason: string }) => Promise<void | boolean>;
  PermissionDenied: (context: { toolName: string; toolCall: ToolCall; reason: string }) => Promise<void>;
  SubagentStart: (context: { task: string; parentSessionId: string }) => Promise<void>;
  SubagentEnd: (context: { task: string; parentSessionId: string; result: string }) => Promise<void>;
  ContextCompression: (context: { currentTokens: number; maxTokens: number }) => Promise<void>;
  ContextCompacted: (context: { previousTokens: number; currentTokens: number; method: string }) => Promise<void>;
  Stop: (context: { reason: 'completed' | 'max_turns' | 'aborted' | 'error'; totalTurns: number }) => Promise<void>;
  Error: (context: { error: Error; turn: number; phase: 'llm' | 'tool' | 'hook' }) => Promise<void>;
  ModelSwitch: (context: { fromModel: string; toModel: string; reason: string }) => Promise<void>;
}
