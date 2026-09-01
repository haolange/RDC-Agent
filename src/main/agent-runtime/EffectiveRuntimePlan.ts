import { createHash, randomBytes } from 'crypto';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { AgentRouteCapability } from '@shared/types/agentRuntime';
import type { PromptPlan, CompiledPolicy, ResourceProvenance } from '@shared/types/rdxRuntime';
import type { AgentPermissionSettings } from '@shared/types/settings';
import type { RequestPlan } from '@shared/types/providerCapability';
import { DEFAULT_CONTEXT_COMPACTION_PERCENT } from '@shared/types/modelCapability';
import { resolveEffectiveCompactionPercent } from '@shared/utils/contextBudget';
import type { ToolDefinition } from './core/types';
import { compileEffectivePolicy, emptyCompiledPolicy } from './permissions/PolicyCompiler';

export interface FrozenHandoffDefinition {
  agent: string;
  label: string;
  prompt: string;
  send?: boolean;
  showContinueOn?: boolean;
  model?: string;
}

export const EFFECTIVE_RUNTIME_PLAN_SCHEMA_VERSION = 3 as const;

export interface EffectiveRuntimePlan {
  schemaVersion: typeof EFFECTIVE_RUNTIME_PLAN_SCHEMA_VERSION;
  planId: string;
  fingerprint: string;
  projectRootPath: string | null;
  projectId: string | null;
  /** Provenance of the exact profile resolved before preparation. */
  profileProvenance: ResourceProvenance | null;
  agentId: string;
  profileSkills: readonly string[];
  profileMaxTurns: number | null;
  /** Exact handoff declarations from the resolved profile. */
  profileHandoffs: readonly FrozenHandoffDefinition[];
  /** Enabled profile ids from the same resolution snapshot. */
  enabledProfileIds: readonly string[];
  /** Frozen effective profile `agents` delegates for subagent authorization. */
  profileDelegates: readonly string[];
  toolAllowlist: readonly string[];
  /**
   * Frozen `∩(skill_i.allowedTools) ∩ toolAllowlist` at prepareTurn.
   * `null` means no skill declared a non-empty allowed-tools set (no narrowing layer).
   */
  skillIntersection: readonly string[] | null;
  /** Names of tools injected into the provider request for this turn. */
  visibleToolNames: readonly string[];
  /** Deferred tools already activated for this turn (serialized ReadonlySet). */
  activatedDeferredTools: readonly string[];
  /** Aggregate hash of enabled MCP descriptors; null when none enabled. */
  mcpDescriptorHash: string | null;
  permissionSettings: AgentPermissionSettings;
  policy: CompiledPolicy;
  /** Stable hash of CompiledPolicy (independent of sourceFingerprint field naming). */
  policyFingerprint: string;
  /** Frozen min(user compaction percent, policy). */
  contextCompactionPercent: number;
  routeCapability: AgentRouteCapability;
  requestPlanFingerprint: string;
  promptPlanFingerprint: string;
  attachmentManifestFingerprint: string | null;
  /** Frozen at plan build; Prompt 与 Executor 共用。 */
  createdAt: number;
}

export interface BuildEffectiveRuntimePlanInput {
  agentId: string;
  projectRootPath: string | null;
  projectId?: string | null;
  profileProvenance?: ResourceProvenance | null;
  profile?: Pick<AgentManifestDefinition, 'skills' | 'maxTurns'> & {
    agents?: AgentManifestDefinition['agents'];
    handoffs?: AgentManifestDefinition['handoffs'];
  } | null;
  enabledProfileIds?: readonly string[];
  profileDelegates?: readonly string[];
  toolAllowlist: readonly string[];
  permissionSettings: AgentPermissionSettings;
  routeCapability: AgentRouteCapability;
  requestPlan: Pick<RequestPlan, 'executionIdentity'> | { executionIdentity: { fingerprint: string } };
  promptPlan: Pick<PromptPlan, 'systemPrompt'> | { systemPrompt: string };
  /** Optional precompiled policy (tests); otherwise load .policy.yml fail-closed. */
  policy?: CompiledPolicy;
  /** Frozen skill ∩ allowlist; omit to leave null (no narrowing). */
  skillIntersection?: readonly string[] | null;
  /** Injected tool names visible to the provider this turn. */
  visibleToolNames?: readonly string[];
  /** Activated deferred tool names (Set or array). */
  activatedDeferredTools?: ReadonlySet<string> | readonly string[];
  /** Aggregate MCP descriptor hash, or null when no MCP servers enabled. */
  mcpDescriptorHash?: string | null;
  /** User-level compaction percent before policy min-merge. */
  compactionThresholdPercent?: number;
  attachmentManifestFingerprint?: string | null;
}

export function policyFingerprintOf(policy: CompiledPolicy): string {
  return stableHash([
    policy.deniedTools,
    policy.approvalFloorByTool,
    policy.approval,
    policy.maxTurns,
    policy.maxToolCalls,
    policy.maxSubagents,
    policy.maxChildDepth,
    policy.maxWallTimeMs,
    policy.contextCompactionPercent,
    policy.sourceFingerprint,
  ]);
}

function stableHash(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}

function freezeStringList(values: readonly string[] | undefined): readonly string[] {
  return Object.freeze([...(values ?? [])]);
}

function serializeActivatedDeferred(
  value: ReadonlySet<string> | readonly string[] | undefined,
): readonly string[] {
  if (!value) return Object.freeze([]);
  const list = Array.isArray(value) ? [...value] : [...value];
  list.sort();
  return Object.freeze(list);
}

/**
 * Turn 开始时解析一次：profile skills / tools / permissions / policy / MCP / deferred。
 * Prompt 与 Tool Executor 必须引用同一 planId/fingerprint。
 */
export function buildEffectiveRuntimePlan(input: BuildEffectiveRuntimePlanInput): EffectiveRuntimePlan {
  const policy = input.policy ?? (
    input.projectRootPath === undefined
      ? emptyCompiledPolicy()
      : compileEffectivePolicy(input.projectRootPath)
  );
  const permissionSettings: AgentPermissionSettings = {
    mode: input.permissionSettings.mode,
    readableRoots: [...input.permissionSettings.readableRoots],
    writableRoots: [...input.permissionSettings.writableRoots],
    allowedCommandPrefixes: [...input.permissionSettings.allowedCommandPrefixes],
    deniedCommandPrefixes: [...input.permissionSettings.deniedCommandPrefixes],
  };
  const profileSkills = freezeStringList(input.profile?.skills ?? []);
  const profileMaxTurns = typeof input.profile?.maxTurns === 'number' && input.profile.maxTurns > 0
    ? input.profile.maxTurns
    : null;
  const profileHandoffs = Object.freeze((input.profile?.handoffs ?? []).map((handoff) => Object.freeze({
    agent: handoff.agent,
    label: handoff.label,
    prompt: handoff.prompt,
    ...(handoff.send !== undefined ? { send: handoff.send } : {}),
    ...(handoff.showContinueOn !== undefined ? { showContinueOn: handoff.showContinueOn } : {}),
    ...(handoff.model !== undefined ? { model: handoff.model } : {}),
  })));
  const enabledProfileIds = freezeStringList(input.enabledProfileIds);
  const profileDelegates = freezeStringList(input.profileDelegates ?? input.profile?.agents ?? []);
  const toolAllowlist = freezeStringList(input.toolAllowlist);
  const skillIntersection = input.skillIntersection === undefined || input.skillIntersection === null
    ? null
    : freezeStringList(input.skillIntersection);
  const visibleToolNames = freezeStringList(input.visibleToolNames);
  const activatedDeferredTools = serializeActivatedDeferred(input.activatedDeferredTools);
  const mcpDescriptorHash = input.mcpDescriptorHash ?? null;
  const policyFingerprint = policyFingerprintOf(policy);
  const requestPlanFingerprint = input.requestPlan.executionIdentity.fingerprint;
  const promptPlanFingerprint = stableHash([input.promptPlan.systemPrompt]);
  const attachmentManifestFingerprint = input.attachmentManifestFingerprint ?? null;
  const contextCompactionPercent = resolveEffectiveCompactionPercent(
    input.compactionThresholdPercent ?? DEFAULT_CONTEXT_COMPACTION_PERCENT,
    policy.contextCompactionPercent,
  );
  const fingerprint = stableHash([
    EFFECTIVE_RUNTIME_PLAN_SCHEMA_VERSION,
    input.agentId,
    input.projectRootPath,
    input.projectId ?? null,
    input.profileProvenance ?? null,
    profileSkills,
    profileMaxTurns,
    profileHandoffs,
    enabledProfileIds,
    profileDelegates,
    toolAllowlist,
    skillIntersection,
    visibleToolNames,
    activatedDeferredTools,
    mcpDescriptorHash,
    permissionSettings,
    policyFingerprint,
    contextCompactionPercent,
    input.routeCapability.toolCallingMode,
    requestPlanFingerprint,
    promptPlanFingerprint,
    attachmentManifestFingerprint,
  ]);
  return {
    schemaVersion: EFFECTIVE_RUNTIME_PLAN_SCHEMA_VERSION,
    planId: `plan_${randomBytes(8).toString('hex')}`,
    fingerprint,
    projectRootPath: input.projectRootPath,
    projectId: input.projectId ?? null,
    profileProvenance: input.profileProvenance ?? null,
    agentId: input.agentId,
    profileSkills,
    profileMaxTurns,
    profileHandoffs,
    enabledProfileIds,
    profileDelegates,
    toolAllowlist,
    skillIntersection,
    visibleToolNames,
    activatedDeferredTools,
    mcpDescriptorHash,
    permissionSettings,
    policy,
    policyFingerprint,
    contextCompactionPercent,
    routeCapability: input.routeCapability,
    requestPlanFingerprint,
    promptPlanFingerprint,
    attachmentManifestFingerprint,
    createdAt: Date.now(),
  };
}

export function activeToolNamesForPlan(
  definitions: readonly ToolDefinition[],
  plan: EffectiveRuntimePlan,
): string[] {
  const allow = new Set(plan.toolAllowlist.map((name) => name.trim().toLowerCase()));
  return definitions
    .map((definition) => definition.name)
    .filter((name) => allow.size === 0 || allow.has(name.trim().toLowerCase()));
}
