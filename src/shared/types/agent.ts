import type { LlmProviderId } from './settings';

export type AgentId = 'general' | 'debugger' | 'analyzer' | 'optimizer';
export type AgentRole = AgentId | (string & {});

export type AgentStatus = 'idle' | 'thinking' | 'executing' | 'waiting' | 'complete' | 'error';

export interface AgentConfig {
  agentId: AgentRole;
  systemPrompt: string;
  modelProvider: LlmProviderId;
  modelName: string;
  temperature?: number;
}

export interface AgentState {
  agentId: AgentRole;
  /** Session or ephemeral execution scope that owns this status projection. */
  sessionId: string;
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

export const TOP_LEVEL_AGENT_IDS: AgentId[] = ['general', 'debugger', 'analyzer', 'optimizer'];
export const MISSION_AGENT_IDS = ['debugger', 'analyzer', 'optimizer'] as const;
export type MissionAgentId = (typeof MISSION_AGENT_IDS)[number];
export const SAFE_AGENT_PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
export const DEFAULT_AGENT_ID: AgentId = 'general';
export const LEGACY_UNKNOWN_PROFILE_ID = 'legacy:unknown';

export const DEFAULT_MODEL_ROUTING: Record<AgentId, { provider: LlmProviderId; model: string }> = {
  general: { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
  debugger: { provider: 'openrouter', model: 'anthropic/claude-3-opus' },
  analyzer: { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
  optimizer: { provider: 'openrouter', model: 'anthropic/claude-3-sonnet' },
};

export function isTopLevelAgentId(value: string): value is AgentId {
  return (TOP_LEVEL_AGENT_IDS as string[]).includes(value);
}

export function isMissionAgentId(value: string): value is MissionAgentId {
  return (MISSION_AGENT_IDS as readonly string[]).includes(value);
}

export function isSafeAgentProfileId(value: string): boolean {
  return SAFE_AGENT_PROFILE_ID_PATTERN.test(value);
}

import type { ToolTraceEntry } from './tool';
import type { ActionEvent } from './evidence';
import type { ReasoningSummary } from './workflow';

export interface AgentTimelineEntry {
  id: string;
  type: 'user' | 'agent' | 'system' | 'tool_call';
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
