import { AppError } from '../errors/appError';
import type { AgentModelBinding, AppLanguage, LlmProviderId } from './settings';
import type { ModeIconKey } from './layout';
import type { ModelCost } from '../provider-catalog/modelManifestSchema';
import type { ReasoningSelection } from './modelCapability';

/** Upper bound on what any tool may do for a profile; no permission mode can exceed it. */
export type AgentAccessCeiling = 'read-only' | 'workspace-write' | 'full';
export const AGENT_ACCESS_CEILINGS = ['read-only', 'workspace-write', 'full'] as const satisfies readonly AgentAccessCeiling[];
export const DEFAULT_AGENT_ACCESS_CEILING: AgentAccessCeiling = 'full';

/** Manifest diagnostics the Agents settings page acts on. */
export const AGENT_PROJECT_UNTRUSTED = 'AGENT_PROJECT_UNTRUSTED';
export const AGENT_PROJECT_CEILING_NARROWED = 'AGENT_PROJECT_CEILING_NARROWED';

/** Obligation a turn must satisfy before it may declare `turn_complete(completed)`. */
export type AgentCompletionContract = 'final-answer' | 'investigation-report';
export const AGENT_COMPLETION_CONTRACTS = ['final-answer', 'investigation-report'] as const satisfies readonly AgentCompletionContract[];
export const DEFAULT_AGENT_COMPLETION_CONTRACT: AgentCompletionContract = 'final-answer';

/**
 * Where a declared handoff is offered:
 * - `turn-end`: after a completed turn and at the plan gate;
 * - `plan-gate`: only when approving a plan submitted with `plan_artifact`;
 * - `hidden`: declared but never offered.
 */
export type HandoffSurface = 'turn-end' | 'plan-gate' | 'hidden';
export const HANDOFF_SURFACES = ['turn-end', 'plan-gate', 'hidden'] as const satisfies readonly HandoffSurface[];

export interface AgentHandoffDefinition {
  label: string;
  labelTranslations?: ManifestTextTranslations;
  agent: string;
  prompt: string;
  send?: boolean;
  /** Omitted means `turn-end`. */
  surface?: HandoffSurface;
  /** Skills the receiving turn must actually preload after this handoff. */
  requiredSkillIds?: string[];
  /** Deferred tools the receiving turn pre-activates (within its own frozen tool set). */
  requiredToolIds?: string[];
}

export function handoffSurfaceOf(handoff: Pick<AgentHandoffDefinition, 'surface'>): HandoffSurface {
  return handoff.surface ?? 'turn-end';
}

export function isHandoffOfferedAtPlanGate(handoff: Pick<AgentHandoffDefinition, 'surface'>): boolean {
  return handoffSurfaceOf(handoff) !== 'hidden';
}

export function isHandoffOfferedAtTurnEnd(handoff: Pick<AgentHandoffDefinition, 'surface'>): boolean {
  return handoffSurfaceOf(handoff) === 'turn-end';
}

export function agentAccessCeiling(profile: { accessCeiling?: AgentAccessCeiling } | null | undefined): AgentAccessCeiling {
  return profile?.accessCeiling ?? DEFAULT_AGENT_ACCESS_CEILING;
}

/** The stricter of two ceilings; a delegated or overriding profile never gains access. */
export function narrowerAccessCeiling(left: AgentAccessCeiling, right: AgentAccessCeiling): AgentAccessCeiling {
  return AGENT_ACCESS_CEILINGS.indexOf(left) <= AGENT_ACCESS_CEILINGS.indexOf(right) ? left : right;
}

export function agentCompletionContract(profile: { completionContract?: AgentCompletionContract } | null | undefined): AgentCompletionContract {
  return profile?.completionContract ?? DEFAULT_AGENT_COMPLETION_CONTRACT;
}

/** Product copy a shipped manifest carries per interface language; the untranslated field is the fallback. */
export type ManifestTextTranslations = Readonly<Partial<Record<AppLanguage, string>>>;

export interface AgentManifestDefinition {
  id: string;
  fileName: string;
  filePath: string;
  name: string;
  description: string;
  argumentHint: string;
  /** Shipped builtins only; never written to user or project copies. */
  descriptionTranslations?: ManifestTextTranslations;
  argumentHintTranslations?: ManifestTextTranslations;
  target: string;
  /** Resolved from Settings → Agents (this Agent's setting, else the default); never read from the file. */
  reasoningLevel?: ReasoningSelection;
  /** Where the resolved model comes from: this Agent's own setting, the default, or nothing configured. */
  modelSource?: 'agent' | 'default' | 'none';
  /** Builtin sourceHash this override was copied from; written by Settings copy-on-write. */
  basedOn?: string;
  /** For a user/project override of a builtin id: whether the builtin changed since the override was copied. */
  builtinUpdate?: { builtinSourceHash: string; status: 'current' | 'updated' | 'unknown-base' };
  icon: ModeIconKey;
  /** Compose accent (#RRGGBB). Drives composer shell glow and Effort slider. */
  accent: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  /** Omitted means `full`: the profile declares no extra tool ceiling. */
  accessCeiling?: AgentAccessCeiling;
  /** Omitted means `final-answer`. */
  completionContract?: AgentCompletionContract;
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
  'filePath' | 'builtin' | 'updatedAt' | 'provenance' | 'compiledRoute' | 'reasoningLevel' | 'modelSource' | 'builtinUpdate'
  | 'descriptionTranslations' | 'argumentHintTranslations'
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
  /** Connection state projected by main when the provider is not executable. */
  providerIssue?: 'unconfigured' | 'failed' | 'unavailable';
  disabledReason?: string;
  /** Explicitly selectable request reasoning values; null means the catalog has not verified them. */
  reasoningSelections?: import('./modelCapability').ReasoningSelection[] | null;
  /** 每百万 token 定价（美元）；模型无定价信息时缺省。 */
  cost?: ModelCost;
  /** 来自 models.json 的用户自定义 / 覆盖模型。 */
  custom?: boolean;
}

export interface AgentManifestDiagnostic {
  code: string;
  severity: 'warning' | 'error';
  scope: 'builtin' | 'user' | 'project';
  agentId: string;
  sourcePath: string;
  message: string;
}

/** The Agents part of the settings view; the model choices are computed in the renderer from the effective catalogs. */
export interface AgentManifestSettings {
  directoryPath: string;
  definitions: AgentManifestDefinition[];
  globalInstructions: string;
  diagnostics: AgentManifestDiagnostic[];
}

export type AgentManifestWriteScope = 'user' | 'project';

/** An override file the user acts on from the diagnostics list; the hash pins the content they reviewed. */
export interface AgentOverrideFileRequest {
  sourcePath: string;
  sourceHash: string;
}

/** What migrating a manifest that still declares model fields will change. */
export interface AgentModelMigrationPreview extends AgentOverrideFileRequest {
  agentId: string;
  scope: AgentManifestWriteScope;
  /** Written to Settings → Agents for this Agent, replacing `currentBinding`. */
  binding: AgentModelBinding;
  currentBinding: AgentModelBinding;
  /** Per-handoff models have no replacement: the target Agent's own setting applies. */
  droppedHandoffModels: Array<{ label: string; agent: string; model: string }>;
  /** Declared values that are not a canonical model id or a supported reasoning level. */
  ignoredValues: string[];
  backupPath: string;
}

/** A project Agent profile awaiting trust, shown in full before the user trusts these exact bytes. */
export interface ProjectAgentTrustPreview extends AgentOverrideFileRequest {
  agentId: string;
  content: string;
}

/** Current builtin and override text of one Agent, for the builtin-update comparison. */
export interface AgentBuiltinComparison {
  agentId: string;
  builtinContent: string;
  overrideContent: string;
}

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
      throw new AppError('AGENT_MANIFEST_PROJECT_ID_REQUIRED', 'project effective profile requires a current projectId.');
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
      throw new AppError('AGENT_MANIFEST_PROJECT_ID_REQUIRED', 'project-scoped editor draft requires a current projectId.');
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
    reasoningLevel: _reasoningLevel,
    modelSource: _modelSource,
    builtinUpdate: _builtinUpdate,
    ...rest
  } = definition;
  const write = resolveAgentWriteTarget(definition, currentProjectId);
  const sourceHash = definition.provenance?.sourceHash;
  return {
    ...rest,
    writeScope: write.scope,
    ...(write.projectId !== undefined ? { writeProjectId: write.projectId } : {}),
    ...(sourceHash !== undefined ? { sourceHash } : {}),
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
