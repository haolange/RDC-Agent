import type { LlmProviderId } from './settings';
import type { ModeIconKey } from './layout';

/** `.agent.md` frontmatter 的显式 harness 偏好；缺省时由模型事实启发式决定。 */
export type AgentHarnessPreference = 'lean' | 'standard';

export interface AgentHandoffDefinition {
  label: string;
  agent: string;
  prompt: string;
  send?: boolean;
  showContinueOn?: boolean;
  model?: string;
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
  icon: ModeIconKey;
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
  /** 工具执行轮数上限；未设置时由 runtime 按 profile 默认值决定。 */
  maxTurns?: number;
  /** Harness 丰俭偏好；未设置时按模型窗口/reasoning 启发式决定。 */
  harness?: AgentHarnessPreference;
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
  status: 'ready' | 'provider-unavailable' | 'model-disabled' | 'model-unavailable' | 'model-unverified' | 'missing';
  disabledReason?: string;
}

export interface AgentManifestSettings {
  directoryPath: string;
  definitions: AgentManifestDefinition[];
  modelOptions: AgentModelOption[];
  globalInstructions: string;
}

export interface AgentDefinitionSaveRequest {
  draft: AgentManifestDraft;
  clientRevision: number;
}

export type AgentDefinitionSaveStatus = 'committed' | 'superseded' | 'failed';

export interface AgentDefinitionCommitSnapshot {
  clientRevision: number;
  commitHash: string;
  definition: AgentManifestDefinition | null;
  route: import('./settings').LlmAgentRoute | null;
}

export interface AgentDefinitionSaveResult {
  clientRevision: number;
  status: AgentDefinitionSaveStatus;
  commitHash: string | null;
  definition: AgentManifestDefinition | null;
  route: import('./settings').LlmAgentRoute | null;
  lastSuccessful: AgentDefinitionCommitSnapshot | null;
  error?: string;
}
