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
  brief?: string;
  lastActivity: string;
  error?: string;
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

export const TOP_LEVEL_AGENT_IDS: AgentId[] = ['general', 'debugger', 'analyzer', 'optimizer'];
export const INTERNAL_BUILTIN_AGENT_IDS = [
  'generator', 'verifier', 'knowledge-scout', 'report-writer',
  'shader-analyst', 'pass-analyst', 'resource-analyst', 'pixel-analyst',
] as const;
export const BUILTIN_AGENT_IDS: readonly string[] = [...TOP_LEVEL_AGENT_IDS, ...INTERNAL_BUILTIN_AGENT_IDS];
export const SAFE_AGENT_PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
export const DEFAULT_AGENT_ID: AgentId = 'general';

export function isTopLevelAgentId(value: string): value is AgentId {
  return (TOP_LEVEL_AGENT_IDS as string[]).includes(value);
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
