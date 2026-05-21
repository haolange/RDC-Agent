import type { AgentRole } from '@shared/types/agent';
import type { LLMStreamEvent } from '@shared/types/llm';
import type { WorkflowStage } from '@shared/types/workflow';
import type { ToolCallResult, ToolDefinition } from '@shared/types/tool';

export interface AgentToolExecutionRequest {
  toolName: string;
  args: Record<string, unknown>;
  runId?: string;
  turnId?: string;
  contextId?: string;
  runtimeOwner?: string;
  ownerLeaseId?: string;
  signal?: AbortSignal;
}

export interface AgentToolPort {
  listTools(agentId: AgentRole): Promise<ToolDefinition[]>;
  execute(request: AgentToolExecutionRequest): Promise<ToolCallResult>;
}

export interface AgentRunRequest {
  agentId: AgentRole;
  prompt: string;
  systemPrompt: string;
  modelId: string;
  providerId: string;
  maxTokens?: number;
  temperature?: number;
  toolAllowlist?: string[];
  stage?: WorkflowStage | 'cowork' | 'report';
  caseId?: string;
  runId?: string;
  sessionId?: string;
  turnId?: string;
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
  onStreamEvent?: (event: LLMStreamEvent) => void;
}

export interface AgentRunResult {
  agentId: AgentRole;
  providerId: string;
  modelId: string;
  text: string;
  structured?: Record<string, unknown>;
  toolResults: Array<{
    toolName: string;
    result: ToolCallResult;
  }>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  trace?: Record<string, unknown>;
}

export interface AgentSdkAdapter {
  readonly id: string;
  canRun(request: AgentRunRequest): boolean;
  run(request: AgentRunRequest, tools: AgentToolPort): Promise<AgentRunResult>;
}
