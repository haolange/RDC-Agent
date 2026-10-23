import { describe, expect, it } from 'vitest';
import type { PromptPlan } from '@shared/types/rdcRuntime';
import { applyExecutionLimitFacts } from './ExecutionLimitFacts';
import { resolveAgentMaxTurns } from '../agent/ExecutionLimits';

const base: PromptPlan = {
  id: 'plan', segments: [], systemPrompt: '', totalTokenEstimate: 0,
  stablePrefix: { fingerprint: 'stable', segmentIds: [], sourceHashes: [], tokenEstimate: 0, volatileSegmentIds: [] },
  metrics: { systemPrompt: 0, scopedInstructions: 0, skills: 0 }, diagnostics: [],
};

describe('frozen execution limit facts', () => {
  it.each([
    [undefined, undefined, 25], [undefined, 50, 50], [900, 50, 50], [8, 50, 8],
    [Number.MAX_SAFE_INTEGER, 12, 12], [Infinity, 12, 12],
  ] as const)('uses the executable resolver for policy %s and profile %s', (policyMaxTurns, profileMaxTurns, expected) => {
    const plan = applyExecutionLimitFacts(base, { policyMaxTurns, profileMaxTurns });
    expect(resolveAgentMaxTurns(policyMaxTurns, profileMaxTurns)).toBe(expected);
    expect(plan.systemPrompt).toContain(`prepared turn: ${expected}`);
    expect(plan.systemPrompt).toContain('not a remaining balance or a tool-call budget');
    expect(plan.systemPrompt).toContain('compaction must be accounted for separately');
  });

  it('rejects zero policy before preparing executable facts', () => {
    expect(() => applyExecutionLimitFacts(base, { policyMaxTurns: 0, profileMaxTurns: 50 })).toThrow('POLICY_MAX_TURNS_ZERO');
  });

  it('replaces facts without mutating the supplied plan or changing its stable prefix', () => {
    const first = applyExecutionLimitFacts(base, { profileMaxTurns: 50 });
    expect(applyExecutionLimitFacts(first, { profileMaxTurns: 50 })).toEqual(first);
    const second = applyExecutionLimitFacts(first, { profileMaxTurns: 50, policyMaxTurns: 4 });
    expect(second.segments).toHaveLength(1);
    expect(second.segments[0].sourceHash).not.toBe(first.segments[0].sourceHash);
    expect(second.stablePrefix.fingerprint).toBe(base.stablePrefix.fingerprint);
    expect(second.stablePrefix.volatileSegmentIds).toEqual(['runtime:execution-limits']);
    expect(second.totalTokenEstimate).toBe(second.segments[0].tokenEstimate);
    expect(second.metrics.systemPrompt).toBe(second.systemPrompt.length);
    expect(base.segments).toEqual([]);
  });
});
