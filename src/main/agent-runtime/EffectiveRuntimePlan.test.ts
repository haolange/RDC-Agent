import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import { createNoneReasoningContract } from '@shared/provider-catalog/providerContracts';
import {
  activeToolNamesForPlan,
  buildEffectiveRuntimePlan,
  policyFingerprintOf,
} from './EffectiveRuntimePlan';
import { compilePolicyFromRestrictive } from './permissions/PolicyCompiler';

const routeCapability = {
  providerId: 'p',
  modelId: 'm',
  toolCallingMode: 'native-structured' as const,
  reasoningVisibility: 'none' as const,
  reasoningDelivery: 'none' as const,
  reasoningContract: createNoneReasoningContract('test'),
  supportsStreaming: true,
  supportsToolResults: true,
  toolCallingUnverified: false,
  visionInputMode: 'disabled' as const,
  structuredOutputMode: 'native' as const,
};

const basePermission = {
  mode: 'default' as const,
  readableRoots: [] as string[],
  writableRoots: [] as string[],
  allowedCommandPrefixes: [] as string[],
  deniedCommandPrefixes: [] as string[],
};

describe('EffectiveRuntimePlan', () => {
  it('freezes permission/policy/tool allowlist under a stable fingerprint', () => {
    const policy = compilePolicyFromRestrictive({ deniedTools: ['bash'], limits: { maxTurns: 7 } });
    const plan = buildEffectiveRuntimePlan({
      agentId: 'ask',
      projectRootPath: 'D:/Project',
      projectId: 'proj-1',
      profile: { skills: ['inspect'] },
      toolAllowlist: ['read_file', 'bash'],
      permissionSettings: basePermission,
      routeCapability,
      requestPlan: { executionIdentity: { fingerprint: 'exec-fp' } },
      promptPlan: { systemPrompt: 'system' },
      policy,
      skillIntersection: ['read_file'],
      visibleToolNames: ['read_file'],
      activatedDeferredTools: new Set(['mcp__x__y']),
      mcpDescriptorHash: 'mcp-hash-1',
    });

    expect(plan.schemaVersion).toBe(3);
    expect(plan.planId).toMatch(/^plan_/);
    expect(plan.fingerprint).toHaveLength(24);
    expect(plan.policy.deniedTools).toContain('bash');
    expect(plan.profileSkills).toEqual(['inspect']);
    expect(plan.skillIntersection).toEqual(['read_file']);
    expect(plan.visibleToolNames).toEqual(['read_file']);
    expect(plan.activatedDeferredTools).toEqual(['mcp__x__y']);
    expect(plan.mcpDescriptorHash).toBe('mcp-hash-1');
    expect(plan.policyFingerprint).toBe(policyFingerprintOf(policy));
    expect(plan.requestPlanFingerprint).toBe('exec-fp');

    const again = buildEffectiveRuntimePlan({
      agentId: 'ask',
      projectRootPath: 'D:/Project',
      projectId: 'proj-1',
      profile: { skills: ['inspect'] },
      toolAllowlist: ['read_file', 'bash'],
      permissionSettings: basePermission,
      routeCapability: plan.routeCapability,
      requestPlan: { executionIdentity: { fingerprint: 'exec-fp' } },
      promptPlan: { systemPrompt: 'system' },
      policy,
      skillIntersection: ['read_file'],
      visibleToolNames: ['read_file'],
      activatedDeferredTools: ['mcp__x__y'],
      mcpDescriptorHash: 'mcp-hash-1',
    });
    expect(again.fingerprint).toBe(plan.fingerprint);
    expect(again.planId).not.toBe(plan.planId);
    expect(again.policyFingerprint).toBe(plan.policyFingerprint);
    expect(createHash('sha256').update(plan.fingerprint).digest('hex')).toHaveLength(64);
  });

  it('keeps the same planId/fingerprint for Prompt and Executor within one turn', () => {
    const policy = compilePolicyFromRestrictive({ deniedTools: [], limits: { maxTurns: 3 } });
    const plan = buildEffectiveRuntimePlan({
      agentId: 'debugger',
      projectRootPath: 'D:/Project',
      projectId: 'proj-2',
      profile: { skills: ['capture'] },
      toolAllowlist: ['read_file', 'grep'],
      permissionSettings: basePermission,
      routeCapability,
      requestPlan: { executionIdentity: { fingerprint: 'turn-exec' } },
      promptPlan: { systemPrompt: 'frozen-system' },
      policy,
      skillIntersection: null,
      visibleToolNames: ['read_file', 'grep'],
      activatedDeferredTools: [],
      mcpDescriptorHash: null,
    });

    // Prompt path and Executor path share the same frozen object identity fields.
    const promptView = {
      planId: plan.planId,
      fingerprint: plan.fingerprint,
      promptPlanFingerprint: plan.promptPlanFingerprint,
      permissionSettings: plan.permissionSettings,
      profileSkills: plan.profileSkills,
      toolAllowlist: plan.toolAllowlist,
    };
    const executorView = {
      planId: plan.planId,
      fingerprint: plan.fingerprint,
      policyFingerprint: plan.policyFingerprint,
      permissionSettings: plan.permissionSettings,
      skillIntersection: plan.skillIntersection,
      toolAllowlist: plan.toolAllowlist,
    };
    expect(promptView.planId).toBe(executorView.planId);
    expect(promptView.fingerprint).toBe(executorView.fingerprint);
    expect(promptView.permissionSettings).toEqual(executorView.permissionSettings);
    expect(promptView.toolAllowlist).toEqual(executorView.toolAllowlist);
  });

  it('does not change frozen plan content when settings inputs would have drifted', () => {
    const policy = compilePolicyFromRestrictive({ deniedTools: ['bash'], limits: { maxTurns: 5 } });
    const plan = buildEffectiveRuntimePlan({
      agentId: 'ask',
      projectRootPath: 'D:/Project',
      profile: { skills: ['inspect'] },
      toolAllowlist: ['read_file'],
      permissionSettings: {
        ...basePermission,
        mode: 'default',
        readableRoots: ['D:/Project'],
      },
      routeCapability,
      requestPlan: { executionIdentity: { fingerprint: 'stable' } },
      promptPlan: { systemPrompt: 'system' },
      policy,
      skillIntersection: ['read_file'],
      visibleToolNames: ['read_file'],
      activatedDeferredTools: new Set<string>(),
      mcpDescriptorHash: null,
    });

    const driftedPermission = {
      ...basePermission,
      mode: 'full-access' as const,
      readableRoots: ['D:/Other'],
    };
    const driftedPolicy = compilePolicyFromRestrictive({
      deniedTools: ['read_file', 'bash'],
      limits: { maxTurns: 99 },
    });
    // Rebuild with drifted inputs produces a different fingerprint — proving the
    // original plan object remains the turn authority if callers keep using it.
    const drifted = buildEffectiveRuntimePlan({
      agentId: 'ask',
      projectRootPath: 'D:/Project',
      profile: { skills: ['other'] },
      toolAllowlist: ['bash'],
      permissionSettings: driftedPermission,
      routeCapability,
      requestPlan: { executionIdentity: { fingerprint: 'stable' } },
      promptPlan: { systemPrompt: 'system' },
      policy: driftedPolicy,
      skillIntersection: null,
      visibleToolNames: ['bash'],
      activatedDeferredTools: [],
      mcpDescriptorHash: 'changed',
    });

    expect(plan.permissionSettings.mode).toBe('default');
    expect(plan.permissionSettings.readableRoots).toEqual(['D:/Project']);
    expect(plan.profileSkills).toEqual(['inspect']);
    expect(plan.toolAllowlist).toEqual(['read_file']);
    expect(plan.skillIntersection).toEqual(['read_file']);
    expect(plan.policy.deniedTools).toContain('bash');
    expect(plan.policy.deniedTools).not.toContain('read_file');
    expect(drifted.fingerprint).not.toBe(plan.fingerprint);
    expect(drifted.policyFingerprint).not.toBe(plan.policyFingerprint);
  });

  it('activeToolNamesForPlan filters by allowlist and allows all when empty', () => {
    const policy = compilePolicyFromRestrictive({ deniedTools: [], limits: { maxTurns: 3 } });
    const plan = buildEffectiveRuntimePlan({
      agentId: 'ask',
      projectRootPath: 'D:/Project',
      profile: { skills: [] },
      toolAllowlist: ['Read_File', 'grep'],
      permissionSettings: basePermission,
      routeCapability,
      requestPlan: { executionIdentity: { fingerprint: 'x' } },
      promptPlan: { systemPrompt: 'system' },
      policy,
      skillIntersection: null,
      visibleToolNames: ['read_file', 'grep'],
      activatedDeferredTools: [],
      mcpDescriptorHash: null,
    });
    expect(activeToolNamesForPlan([
      { name: 'read_file', description: '', parameters: { type: 'object', properties: {} } },
      { name: 'bash', description: '', parameters: { type: 'object', properties: {} } },
    ], plan)).toEqual(['read_file']);

    const openPlan = buildEffectiveRuntimePlan({
      agentId: 'ask',
      projectRootPath: 'D:/Project',
      profile: { skills: [] },
      toolAllowlist: [],
      permissionSettings: basePermission,
      routeCapability,
      requestPlan: { executionIdentity: { fingerprint: 'y' } },
      promptPlan: { systemPrompt: 'system' },
      policy,
      skillIntersection: null,
      visibleToolNames: [],
      activatedDeferredTools: [],
      mcpDescriptorHash: null,
    });
    expect(activeToolNamesForPlan([
      { name: 'a', description: '', parameters: { type: 'object', properties: {} } },
      { name: 'b', description: '', parameters: { type: 'object', properties: {} } },
    ], openPlan)).toEqual(['a', 'b']);
  });

  it('freezes min(user, policy) compaction percent into the fingerprint', () => {
    const tightened = compilePolicyFromRestrictive({ limits: { contextCompactionPercent: 70 } });
    const unlimited = compilePolicyFromRestrictive({ limits: {} });
    const shared = {
      agentId: 'ask',
      projectRootPath: 'D:/Project',
      projectId: 'proj-1',
      profile: { skills: ['inspect'] },
      toolAllowlist: ['read_file'],
      permissionSettings: basePermission,
      routeCapability,
      requestPlan: { executionIdentity: { fingerprint: 'exec-fp' } },
      promptPlan: { systemPrompt: 'system' },
      skillIntersection: ['read_file'] as const,
      visibleToolNames: ['read_file'] as const,
      activatedDeferredTools: [] as string[],
      mcpDescriptorHash: 'mcp-hash-1',
    };

    const plan = buildEffectiveRuntimePlan({
      ...shared,
      policy: tightened,
      compactionThresholdPercent: 80,
    });
    const unlimitedPlan = buildEffectiveRuntimePlan({
      ...shared,
      policy: unlimited,
      compactionThresholdPercent: 80,
    });

    expect(plan.contextCompactionPercent).toBe(70);
    expect(unlimitedPlan.contextCompactionPercent).toBe(80);
    expect(plan.fingerprint).not.toBe(unlimitedPlan.fingerprint);
    expect(policyFingerprintOf(tightened)).not.toBe(policyFingerprintOf(unlimited));
  });
});
