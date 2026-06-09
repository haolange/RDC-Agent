import type { LlmProviderId } from './settings';

export interface AgentHandoffDefinition {
  label: string;
  agent: string;
  prompt: string;
  send?: boolean;
  showContinueOn?: boolean;
}

export interface AgentManifestDefinition {
  id: string;
  fileName: string;
  filePath: string;
  name: string;
  description: string;
  argumentHint: string;
  target: string;
  models: string[];
  disableModelInvocation: boolean;
  userInvocable: boolean;
  tools: string[];
  skills: string[];
  mcpServers: string[];
  agents: string[];
  handoffs: AgentHandoffDefinition[];
  metadata: Record<string, unknown>;
  instructions: string;
  builtin: boolean;
  enabled: boolean;
  updatedAt?: string;
}

export interface AgentManifestDraft extends Omit<AgentManifestDefinition, 'filePath' | 'builtin' | 'updatedAt'> {
  delete?: boolean;
}

export interface AgentModelOption {
  canonicalId: string;
  providerId: LlmProviderId;
  providerLabel: string;
  modelId: string;
  modelLabel: string;
  configured: boolean;
}

export interface AgentManifestSettings {
  directoryPath: string;
  definitions: AgentManifestDefinition[];
  modelOptions: AgentModelOption[];
  globalInstructions: string;
}
