import type { LlmProviderId } from './settings';

export type AgentId = 'ask' | 'debugger' | 'analyzer' | 'optimizer';
export type AgentRole = AgentId | (string & {});

export type AgentCategory = 'orchestrator' | 'general';

export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'waiting' | 'complete' | 'error';

export interface AgentConfig {
  agentId: AgentRole;
  systemPrompt: string;
  modelProvider: LlmProviderId;
  modelName: string;
  temperature?: number;
  maxTokens?: number;
  category: AgentCategory;
  writeScope: WriteScope[];
}

export type WriteScope =
  | 'workspace_control'
  | 'workspace_notes'
  | 'session_signoff'
  | 'workspace_reports'
  | 'session_artifacts'
  | 'knowledge_library';

export interface AgentState {
  agentId: AgentRole;
  status: AgentStatus;
  token?: SpecialistToken;
  brief?: string;
  lastActivity: string;
  error?: string;
}

export interface SpecialistToken {
  token_id: string;
  agent_id: AgentRole;
  issued_at: string;
  expires_at: string;
  scope: string[];
  status: 'valid' | 'expired' | 'revoked';
  runtime_owner: string;
}

export interface AgentMessage {
  id: string;
  agentId: AgentRole;
  role: 'assistant' | 'user' | 'system';
  content: string;
  timestamp: number;
  toolCalls?: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: unknown;
  }[];
}

export interface AgentConversation {
  id: string;
  caseId: string;
  runId: string;
  sessionId: string;
  messages: AgentMessage[];
  activeAgent: AgentRole;
  lastUpdated: string;
}

export const TOP_LEVEL_AGENT_IDS: AgentId[] = ['ask', 'debugger', 'analyzer', 'optimizer'];

export const DEFAULT_MODEL_ROUTING: Record<AgentId, { provider: LlmProviderId; model: string }> = {
  ask: { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
  debugger: { provider: 'openrouter', model: 'anthropic/claude-3-opus' },
  analyzer: { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
  optimizer: { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
};

export const AGENT_CATEGORY_MAP: Record<AgentId, AgentCategory> = {
  ask: 'orchestrator',
  debugger: 'general',
  analyzer: 'general',
  optimizer: 'general',
};

export function isTopLevelAgentId(value: string): value is AgentId {
  return (TOP_LEVEL_AGENT_IDS as string[]).includes(value);
}

import type { ToolTraceEntry } from './tool';
import type { ActionEvent } from './evidence';
import type { ReasoningSummary } from './workflow';

export interface AgentTimelineEntry {
  id: string;
  type:
    | 'user'
    | 'agent'
    | 'tool_call'
    | 'blocker'
    | 'system'
    | 'plan'
    | 'stage'
    | 'dispatch'
    | 'verification'
    | 'report'
    | 'reasoning';
  agentRole?: AgentRole;
  content: string;
  title?: string;
  status?: string;
  toolTrace?: ToolTraceEntry;
  actionEvent?: ActionEvent;
  reasoningSummary?: ReasoningSummary;
  timestamp: number;
  refs?: string[];
}
