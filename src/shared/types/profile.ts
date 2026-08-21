import type { AgentRole, WriteScope } from './agent';
import type { LlmProviderId } from './settings';
import type { WorkflowPhase, WorkflowStage } from './workflow';

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

export interface EffectiveAgentRuntimeConfig {
  agentId: AgentRole;
  systemPrompt: string;
  providerId: LlmProviderId;
  modelId: string;
  temperature?: number;
  category?: string;
  writeScope?: WriteScope[];
  stage: WorkflowStage;
  phase: WorkflowPhase;
  toolAllowlist: string[];
  skillIds: string[];
  mcpServerIds: string[];
  source: {
    agentProfileId: string;
  };
}
