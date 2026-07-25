import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import { createNoneReasoningContract } from '@shared/provider-catalog/providerContracts';
import { buildEffectiveRuntimePlan } from './EffectiveRuntimePlan';
import { compilePolicyFromRestrictive } from './permissions/PolicyCompiler';

describe('EffectiveRuntimePlan', () => {
  it('freezes permission/policy/tool allowlist under a stable fingerprint', () => {
    const policy = compilePolicyFromRestrictive({ deniedTools: ['bash'], limits: { maxTurns: 7 } });
    const plan = buildEffectiveRuntimePlan({
      agentId: 'ask',
      projectRootPath: 'D:/Project',
      projectId: 'proj-1',
      profile: { skills: ['inspect'] },
      toolAllowlist: ['read_file', 'bash'],
      permissionSettings: {
        mode: 'default',
        readableRoots: [],
        writableRoots: [],
        allowedCommandPrefixes: [],
        deniedCommandPrefixes: [],
      },
      routeCapability: {
        providerId: 'p',
        modelId: 'm',
        toolCallingMode: 'native-structured',
        reasoningVisibility: 'none',
        reasoningDelivery: 'none',
        reasoningContract: createNoneReasoningContract('test'),
        supportsStreaming: true,
        supportsToolResults: true,
        toolCallingUnverified: false,
        visionInputMode: 'disabled',
        structuredOutputMode: 'native',
      },
      requestPlan: { executionIdentity: { fingerprint: 'exec-fp' } },
      promptPlan: { systemPrompt: 'system' },
      policy,
    });

    expect(plan.planId).toMatch(/^plan_/);
    expect(plan.fingerprint).toHaveLength(24);
    expect(plan.policy.deniedTools).toContain('bash');
    expect(plan.profileSkills).toEqual(['inspect']);
    expect(plan.requestPlanFingerprint).toBe('exec-fp');

    const again = buildEffectiveRuntimePlan({
      agentId: 'ask',
      projectRootPath: 'D:/Project',
      projectId: 'proj-1',
      profile: { skills: ['inspect'] },
      toolAllowlist: ['read_file', 'bash'],
      permissionSettings: {
        mode: 'default',
        readableRoots: [],
        writableRoots: [],
        allowedCommandPrefixes: [],
        deniedCommandPrefixes: [],
      },
      routeCapability: plan.routeCapability,
      requestPlan: { executionIdentity: { fingerprint: 'exec-fp' } },
      promptPlan: { systemPrompt: 'system' },
      policy,
    });
    expect(again.fingerprint).toBe(plan.fingerprint);
    expect(again.planId).not.toBe(plan.planId);
    expect(createHash('sha256').update(plan.fingerprint).digest('hex')).toHaveLength(64);
  });
});
