import type { AgentRole } from './agent';
import type { LlmProviderId } from './settings';

export interface AgentToolPolicy {
  allowTools?: string[];
  allowGroups?: string[];
}

export interface AgentPromptProfile {
  id: string;
  label: string;
  agentId: AgentRole;
  systemPrompt: string;
  modelProvider?: LlmProviderId;
  modelName?: string;
  temperature?: number;
  toolPolicy?: AgentToolPolicy;
}

export interface AgentProfile {
  id: string;
  label: string;
  agentId: AgentRole;
  systemPrompt: string;
  allowedTools: string[];
  providerId?: LlmProviderId;
  modelId?: string;
  temperature?: number;
}
