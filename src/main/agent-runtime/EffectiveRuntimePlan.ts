import type { TaskCompletionBinding } from './agent/TurnCompletionValidator';
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
import type { DelegationCapsule } from '@shared/types/delegationCapsule';
import { freezeDelegationCapsule } from '@shared/types/delegationCapsule';
import { isRdxLeaseToolName, stripRdxLeaseToolsFromAllowlist } from '@shared/constants/rdxLeaseTools';
import { filterMissionPlanOnlyAllowlist, isMissionProfileId } from '@shared/constants/missionPlanOnly';

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
  taskBinding: Readonly<TaskCompletionBinding> | null;
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
  /**
   * Frozen canonical knowledge read roots (realpath, existing real directories only).
   * Not written into persisted permissionSettings.readableRoots.
   */
  knowledgeReadRoots: readonly string[];
  policy: CompiledPolicy;
  /** Stable hash of CompiledPolicy (independent of sourceFingerprint field naming). */
  policyFingerprint: string;
  /** Frozen min(user compaction percent, policy). */
  contextCompactionPercent: number;
  routeCapability: AgentRouteCapability;
  requestPlanFingerprint: string;
  promptPlanFingerprint: string;
  attachmentManifestFingerprint: string | null;
  /**
   * Offline child plans strip RDX lease tools at compile time.
   * Executor / tool_search must keep denying those ids even if a wildcard remains.
   */
  excludeRdxLeaseTools: boolean;
  /** Frozen Delegation Capsule when this plan was prepared for a subagent child. */
  delegationCapsule: DelegationCapsule | null;
  /** Frozen at plan build; Prompt 与 Executor 共用。 */
  rdxBindingFingerprint?: string;
  createdAt: number;
}

export interface BuildEffectiveRuntimePlanInput {
  taskBinding?: TaskCompletionBinding | null;
  rdxBindingFingerprint?: string;
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
  /** Existing real knowledge directories; omitted when empty. Never copied into readableRoots. */
  knowledgeReadRoots?: readonly string[];
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
  /** When true, strip rdx_context / rdx_probe from frozen allowlists. */
  excludeRdxLeaseTools?: boolean;
  /** Structured clone stored on the child plan after capsule freeze. */
  delegationCapsule?: DelegationCapsule | null;
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
  const knowledgeReadRoots = freezeStringList(input.knowledgeReadRoots);
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
  const excludeRdxLeaseTools = input.excludeRdxLeaseTools === true;
  const applyMissionFilter = (values: readonly string[]): readonly string[] => (
    isMissionProfileId(input.agentId) ? filterMissionPlanOnlyAllowlist(values) : [...values]
  );
  const rawAllowlist = excludeRdxLeaseTools
    ? stripRdxLeaseToolsFromAllowlist(input.toolAllowlist)
    : input.toolAllowlist;
  const toolAllowlist = freezeStringList(applyMissionFilter(rawAllowlist));
  const skillIntersection = input.skillIntersection === undefined || input.skillIntersection === null
    ? null
    : freezeStringList(applyMissionFilter(
      excludeRdxLeaseTools
        ? stripRdxLeaseToolsFromAllowlist(input.skillIntersection)
        : input.skillIntersection,
    ));
  const visibleToolNames = freezeStringList(applyMissionFilter(
    excludeRdxLeaseTools
      ? stripRdxLeaseToolsFromAllowlist(input.visibleToolNames ?? [])
      : input.visibleToolNames ?? [],
  ));
  const delegationCapsule = input.delegationCapsule
    ? freezeDelegationCapsule(structuredClone(input.delegationCapsule))
    : null;
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
  const taskBinding = input.taskBinding ? Object.freeze({ ...input.taskBinding }) : null;
  const fingerprint = stableHash([
    taskBinding,
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
    knowledgeReadRoots,
    policyFingerprint,
    contextCompactionPercent,
    input.routeCapability.toolCallingMode,
    requestPlanFingerprint,
    promptPlanFingerprint,
    attachmentManifestFingerprint,
    input.rdxBindingFingerprint ?? null,
    excludeRdxLeaseTools,
    delegationCapsule,
  ]);
  return {
    taskBinding,
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
    knowledgeReadRoots,
    policy,
    policyFingerprint,
    contextCompactionPercent,
    routeCapability: input.routeCapability,
    requestPlanFingerprint,
    promptPlanFingerprint,
    attachmentManifestFingerprint,
    excludeRdxLeaseTools,
    delegationCapsule,
    rdxBindingFingerprint: input.rdxBindingFingerprint,
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
    .filter((name) => {
      if (plan.excludeRdxLeaseTools && isRdxLeaseToolName(name)) {
        return false;
      }
      return allow.size === 0 || allow.has(name.trim().toLowerCase());
    });
}
