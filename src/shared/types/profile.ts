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
  maxTokens?: number;
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
  maxTokens?: number;
}

export interface StagePolicy {
  id: string;
  label: string;
  stage: WorkflowStage;
  phase: WorkflowPhase;
  agentPromptId?: string;
  systemPrompt?: string;
  notes?: string;
  toolPolicy?: AgentToolPolicy;
}

export interface ModeProfile {
  id: string;
  label: string;
  mode: import('./session').ExecutableAppMode;
  patternId?: string;
  skillIds?: string[];
  mcpServerIds?: string[];
  stagePolicies: Partial<Record<WorkflowStage, string>>;
  defaultAgentPrompts: Partial<Record<AgentRole, string>>;
}

export interface ExecutionModeProfileDescriptor {
  id: string;
  label: string;
}

export interface ResolvedAgentRuntimeProfile {
  agentId: AgentRole;
  systemPrompt: string;
  providerId: LlmProviderId;
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  stage: WorkflowStage;
  phase: WorkflowPhase;
  toolAllowlist: string[];
  modeProfileId: string;
  stagePolicyId?: string;
  agentPromptId?: string;
  source: {
    modeProfileId: string;
    stagePolicyId: string;
    agentProfileId: string;
  };
}

export interface EffectiveAgentRuntimeConfig {
  agentId: AgentRole;
  systemPrompt: string;
  providerId: LlmProviderId;
  modelId: string;
  temperature?: number;
  maxTokens?: number;
  category?: string;
  writeScope?: WriteScope[];
  stage: WorkflowStage;
  phase: WorkflowPhase;
  toolAllowlist: string[];
  patternId?: string;
  skillIds: string[];
  mcpServerIds: string[];
  source: {
    modeProfileId: string;
    stagePolicyId: string;
    agentProfileId: string;
  };
}
