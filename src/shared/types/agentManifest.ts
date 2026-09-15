import type { LlmProviderId } from './settings';
import type { ModeIconKey } from './layout';
import type { ModelCost } from '../provider-catalog/modelManifestSchema';

export interface AgentHandoffDefinition {
  label: string;
  agent: string;
  prompt: string;
  send?: boolean;
  showContinueOn?: boolean;
  model?: string;
  requiredSkillIds?: string[];
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
  /** Compose accent (#RRGGBB). Drives composer shell glow and Effort slider. */
  accent: string;
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
  compiledRoute?: {
    agentId: string;
    providerId: string;
    modelId: string;
  };
  /** 工具执行轮数上限；未设置时由 runtime 按 profile 默认值决定。 */
  maxTurns?: number;
  updatedAt?: string;
  provenance?: AgentManifestProvenance;
}

export interface AgentManifestProvenance {
  scope: 'builtin' | 'user' | 'project';
  sourcePath: string;
  sourceHash: string;
}

export interface AgentManifestDraft extends Omit<
  AgentManifestDefinition,
  'filePath' | 'builtin' | 'updatedAt' | 'provenance' | 'compiledRoute'
> {
  delete?: boolean;
  writeScope?: AgentManifestWriteScope;
  writeProjectId?: string;
  sourceHash?: string;
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
  /** 每百万 token 定价（美元）；模型无定价信息时缺省。 */
  cost?: ModelCost;
  /** 来自 models.json 的用户自定义 / 覆盖模型。 */
  custom?: boolean;
}

export interface AgentManifestSettings {
  directoryPath: string;
  definitions: AgentManifestDefinition[];
  modelOptions: AgentModelOption[];
  globalInstructions: string;
  diagnostics: string[];
}

export type AgentManifestWriteScope = 'user' | 'project';

export interface AgentDefinitionCommitQuery {
  agentId: string;
  scope: AgentManifestWriteScope;
  projectId?: string;
}

export function agentDefinitionLaneKey(
  scope: AgentManifestWriteScope,
  projectId: string | undefined,
  agentId: string,
): string {
  return scope === 'project' ? `project:${projectId ?? ''}:${agentId}` : `user:${agentId}`;
}

export function resolveAgentWriteTarget(
  definition: { provenance?: AgentManifestProvenance } | null | undefined,
  currentProjectId?: string | null,
): { scope: AgentManifestWriteScope; projectId?: string } {
  if (definition?.provenance?.scope === 'project') {
    const projectId = currentProjectId?.trim();
    if (!projectId) {
      throw new Error('AGENT_MANIFEST_PROJECT_ID_REQUIRED: project effective profile requires a current projectId.');
    }
    return { scope: 'project', projectId };
  }
  return { scope: 'user' };
}

export function resolveAgentWriteTargetFromDraft(
  draft: Pick<AgentManifestDraft, 'writeScope' | 'writeProjectId'>,
  currentProjectId?: string | null,
): { scope: AgentManifestWriteScope; projectId?: string } {
  if (draft.writeScope === 'project') {
    const projectId = draft.writeProjectId?.trim() || currentProjectId?.trim();
    if (!projectId) {
      throw new Error('AGENT_MANIFEST_PROJECT_ID_REQUIRED: project-scoped editor draft requires a current projectId.');
    }
    return { scope: 'project', projectId };
  }
  return { scope: 'user' };
}

export function toAgentManifestEditorDraft(
  definition: AgentManifestDefinition,
  currentProjectId?: string | null,
): AgentManifestDraft {
  const {
    filePath: _filePath,
    builtin: _builtin,
    updatedAt: _updatedAt,
    provenance: _provenance,
    compiledRoute: _compiledRoute,
    ...rest
  } = definition;
  const write = resolveAgentWriteTarget(definition, currentProjectId);
  return {
    ...rest,
    writeScope: write.scope,
    writeProjectId: write.projectId,
    sourceHash: definition.provenance?.sourceHash,
  };
}

export interface AgentDefinitionSaveRequest {
  draft: AgentManifestDraft;
  clientRevision: number;
  scope: AgentManifestWriteScope;
  projectId?: string;
  sourceHash?: string;
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
