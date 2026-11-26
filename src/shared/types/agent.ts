export type AgentId = 'general' | 'debugger' | 'analyzer' | 'optimizer';
export type AgentRole = AgentId | (string & {});

export const TOP_LEVEL_AGENT_IDS: AgentId[] = ['general', 'debugger', 'analyzer', 'optimizer'];
/** The only agent that executes approved plans and operates live replay. */
export const GENERAL_AGENT_ID: AgentId = 'general';
export const DEFAULT_AGENT_ID: AgentId = GENERAL_AGENT_ID;

export function isTopLevelAgentId(value: string): value is AgentId {
  return (TOP_LEVEL_AGENT_IDS as string[]).includes(value);
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
