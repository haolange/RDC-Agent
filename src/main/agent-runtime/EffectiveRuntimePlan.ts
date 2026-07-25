import { createHash, randomBytes } from 'crypto';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { AgentRouteCapability } from '@shared/types/agentRuntime';
import type { PromptPlan, CompiledPolicy } from '@shared/types/rdxRuntime';
import type { AgentPermissionSettings } from '@shared/types/settings';
import type { RequestPlan } from '@shared/types/providerCapability';
import type { ToolDefinition } from './core/types';
import { compileEffectivePolicy, emptyCompiledPolicy } from './permissions/PolicyCompiler';

export const EFFECTIVE_RUNTIME_PLAN_SCHEMA_VERSION = 1 as const;

export interface EffectiveRuntimePlan {
  schemaVersion: typeof EFFECTIVE_RUNTIME_PLAN_SCHEMA_VERSION;
  planId: string;
  fingerprint: string;
  projectRootPath: string | null;
  projectId: string | null;
  agentId: string;
  profileSkills: readonly string[];
  toolAllowlist: readonly string[];
  permissionSettings: AgentPermissionSettings;
  policy: CompiledPolicy;
  routeCapability: AgentRouteCapability;
  requestPlanFingerprint: string;
  promptPlanFingerprint: string;
  /** Frozen at plan build; Prompt 与 Executor 共用。 */
  createdAt: number;
}

export interface BuildEffectiveRuntimePlanInput {
  agentId: string;
  projectRootPath: string | null;
  projectId?: string | null;
  profile?: Pick<AgentManifestDefinition, 'skills'> | null;
  toolAllowlist: readonly string[];
  permissionSettings: AgentPermissionSettings;
  routeCapability: AgentRouteCapability;
  requestPlan: Pick<RequestPlan, 'executionIdentity'> | { executionIdentity: { fingerprint: string } };
  promptPlan: Pick<PromptPlan, 'systemPrompt'> | { systemPrompt: string };
  /** Optional precompiled policy (tests); otherwise load .policy.yml fail-closed. */
  policy?: CompiledPolicy;
}

function stableHash(parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);
}

/**
 * Turn 开始时解析一次：profile skills / tools / permissions / policy。
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
  const profileSkills = Object.freeze([...(input.profile?.skills ?? [])]);
  const toolAllowlist = Object.freeze([...input.toolAllowlist]);
  const requestPlanFingerprint = input.requestPlan.executionIdentity.fingerprint;
  const promptPlanFingerprint = stableHash([input.promptPlan.systemPrompt]);
  const fingerprint = stableHash([
    EFFECTIVE_RUNTIME_PLAN_SCHEMA_VERSION,
    input.agentId,
    input.projectRootPath,
    input.projectId ?? null,
    profileSkills,
    toolAllowlist,
    permissionSettings,
    policy,
    input.routeCapability.toolCallingMode,
    requestPlanFingerprint,
    promptPlanFingerprint,
  ]);
  return {
    schemaVersion: EFFECTIVE_RUNTIME_PLAN_SCHEMA_VERSION,
    planId: `plan_${randomBytes(8).toString('hex')}`,
    fingerprint,
    projectRootPath: input.projectRootPath,
    projectId: input.projectId ?? null,
    agentId: input.agentId,
    profileSkills,
    toolAllowlist,
    permissionSettings,
    policy,
    routeCapability: input.routeCapability,
    requestPlanFingerprint,
    promptPlanFingerprint,
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
