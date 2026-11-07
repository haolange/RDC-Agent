import { expect, it } from 'vitest';
import type { PromptPlan } from '@shared/types/rdcRuntime';
import type { RdcContextLease } from '../../rdc/RdcRuntimeContextRegistry';
import { refreshPromptPlanRuntimeIdentity } from './PromptPlanRuntimeIdentity';

it('replaces the volatile replay identity while preserving stable instructions and the original plan', () => {
  const plan = { id: 'plan', systemPrompt: 'stable\n\nold identity', totalTokenEstimate: 3,
    segments: [
      { id: 'core', kind: 'core-contract', scope: 'builtin', sourcePath: 'builtin', sourceHash: 'hash', precedence: 0,
        content: 'stable', tokenEstimate: 1, stability: 'stable' },
      { id: 'runtime:identity', kind: 'runtime-fact', scope: 'runtime', sourcePath: 'runtime://identity', sourceHash: 'hash', precedence: 1,
        content: 'old identity', tokenEstimate: 2, stability: 'volatile' },
    ], stablePrefix: { fingerprint: 'unchanged', segmentIds: ['core'], sourceHashes: ['source'], tokenEstimate: 1, volatileSegmentIds: ['runtime:identity'] },
    metrics: { systemPrompt: 20, scopedInstructions: 0, skills: 0 }, diagnostics: [] } as PromptPlan;
  const lease = { ownerSessionId: 'session', ownerProjectId: 'project', contextId: 'new-context', version: 3,
    captureHash: '0123456789abcdef', runtimeContext: { contextId: 'new-context', replaySessionId: 'new-replay' } } as RdcContextLease;
  const next = refreshPromptPlanRuntimeIdentity(plan, 'session', 7, lease);
  expect(next.systemPrompt).toContain('contextId: new-context');
  expect(next.systemPrompt).toContain('captureIdentityDigest: 0123456789abcdef');
  expect(next.systemPrompt).not.toContain('captureSha256:');
  expect(next.stablePrefix).toEqual(plan.stablePrefix);
  expect(plan.systemPrompt).toBe('stable\n\nold identity');
});
