/**
 * Shared Agent Runtime event types for the IPC contract.
 *
 * Core runtime events are translated into this shared shape by
 * src/main/agent-runtime/AgentEventBridge.ts before renderer projection.
 */import type { AgentRole } from './agent';
import type { LLMStreamEvent, ToolCall } from './llm';
import type { MCPTransport } from './mcp';
import type { AgentPromptProfile, AgentToolPolicy } from './profile';
import type { AppMode, ExecutableAppMode } from './session';
import type { LlmProviderAuthMode, LlmProviderId, LlmProviderProtocol } from './settings';
import type { ToolCallResult } from './tool';
import type { WorkflowPhase, WorkflowStage } from './workflow';

export type ToolCallingMode = 'native-structured' | 'text-only' | 'disabled';

export type ReasoningVisibility = 'summary-events' | 'hidden' | 'none';

export interface AgentRouteCapability {
  providerId: LlmProviderId;
  modelId: string;
  toolCallingMode: ToolCallingMode;
  reasoningVisibility: ReasoningVisibility;
  supportsStreaming: boolean;
  supportsToolResults: boolean;
}

export type AgentEventType =
  | 'run.started'
  | 'assistant.delta'
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
  | 'run.cancelled';

export interface AgentEventBasePayload {
  [key: string]: unknown;
}

export interface AgentRunStartedPayload extends AgentEventBasePayload {
  mode: AppMode;
  patternId?: string;
  providerId: string;
  modelId: string;
  toolAllowlist: string[];
}

export interface AgentAssistantDeltaPayload extends AgentEventBasePayload {
  text: string;
}

export interface AgentAssistantCompletedPayload extends AgentEventBasePayload {
  text: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface AgentToolRequestedPayload extends AgentEventBasePayload {
  toolCall: ToolCall;
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
  status?: string;
  parentTaskId?: string;
}

export interface AgentApprovalEventPayload extends AgentEventBasePayload {
  approvalId: string;
  title: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  reason?: string;
  kind?: 'tool' | 'ask_user' | 'run_start';
  toolCallId?: string;
  toolName?: string;
  question?: string;
  options?: string[];
  answer?: unknown;
}

export interface AgentDiagnosticPayload extends AgentEventBasePayload {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  technicalMessage?: string;
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

export type AgentEventPayload =
  | AgentRunStartedPayload
  | AgentAssistantDeltaPayload
  | AgentAssistantCompletedPayload
  | AgentToolRequestedPayload
  | AgentToolStartedPayload
  | AgentToolCompletedPayload
  | AgentToolDeniedPayload
  | AgentTaskEventPayload
  | AgentApprovalEventPayload
  | AgentDiagnosticPayload
  | AgentRunFinalPayload;

export interface AgentEvent {
  id: string;
  type: AgentEventType;
  timestamp: number;
  runId?: string;
  turnId?: string;
  sessionId?: string | null;
  agentId?: AgentRole;
  stage?: WorkflowStage | 'report';
  phase?: WorkflowPhase;
  payload: AgentEventPayload;
}

export interface AgentRuntimeStageDescriptor {
  id: string;
  label: string;
  stage: WorkflowStage;
  phase: WorkflowPhase;
  requiresApproval?: boolean;
  verifierAgents?: AgentRole[];
}

export interface AgentRuntimePatternDescriptor {
  id: string;
  label: string;
  description: string;
  modeBindings: ExecutableAppMode[];
  stages: AgentRuntimeStageDescriptor[];
  finalStatusOwner: 'runtime';
}

export interface AgentRuntimeSkillDescriptor {
  id: string;
  name: string;
  label: string;
  description: string;
  source: 'builtin' | 'plugin' | 'workspace';
  enabledByDefault: boolean;
  path?: string;
  parameters?: Record<string, unknown>;
}

export interface AgentRuntimeSkillWriteRequest {
  id: string;
  previousId?: string;
  label: string;
  description: string;
  markdown: string;
  enabledByDefault?: boolean;
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
  stage?: WorkflowStage | 'report';
  phase?: WorkflowPhase;
  dependsOn?: string[];
}

export interface AgentRuntimeTaskGraphDescriptor {
  id: string;
  runId: string;
  mode: ExecutableAppMode;
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
}

export interface AgentRuntimeMcpWriteRequest {
  id: string;
  previousId?: string;
  name: string;
  description: string;
  transport: MCPTransport;
  enabledByDefault?: boolean;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

export interface AgentRuntimeCatalog {
  patterns: AgentRuntimePatternDescriptor[];
  skills: AgentRuntimeSkillDescriptor[];
  mcpServers: AgentRuntimeMcpDescriptor[];
}
