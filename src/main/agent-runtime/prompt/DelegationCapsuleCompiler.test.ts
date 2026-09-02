import { describe, expect, it } from 'vitest';
import {
  DELEGATION_CAPSULE_ERROR,
  parseDelegationCapsule,
  type DelegationCapsule,
} from '@shared/types/delegationCapsule';
import {
  applyDelegationCapsuleToPromptPlan,
  compileDelegationCapsule,
  renderDelegationCapsulePrompt,
} from './DelegationCapsuleCompiler';
import type { PromptPlan } from '@shared/types/rdxRuntime';

function validCapsule(overrides: Partial<DelegationCapsule> = {}): DelegationCapsule {
  return {
    mission: 'Find the draw call that writes red.',
    task: 'inspect the color target',
    acceptedFacts: ['Frame 12 presents a triangle'],
    forbiddenPaths: ['Do not mutate shaders'],
    inputArtifactRefs: ['session://tool-outputs/notes/a.md'],
    outputRequirements: 'Return the event id and evidence refs.',
    budget: { maxToolCalls: 8, maxWallTimeMs: 60_000 },
    requiresRdxLease: false,
    ...overrides,
  };
}

describe('DelegationCapsule', () => {
  it('parses a complete capsule and compiles PromptPlan segments', () => {
    const capsule = parseDelegationCapsule(validCapsule());
    const segments = compileDelegationCapsule(capsule);
    expect(segments.every((segment) => segment.kind === 'delegation-capsule')).toBe(true);
    expect(segments.every((segment) => segment.stability === 'volatile')).toBe(true);
    const prompt = renderDelegationCapsulePrompt(segments);
    expect(prompt).toContain('Delegation Mission');
    expect(prompt).toContain('inspect the color target');
    expect(prompt).toContain('session://tool-outputs/notes/a.md');
    expect(prompt).toContain('requiresRdxLease: false');
    expect(Object.isFrozen(capsule)).toBe(true);
    expect(Object.isFrozen(capsule.budget)).toBe(true);
    expect(Object.isFrozen(segments)).toBe(true);
    expect(() => {
      (capsule as { task: string }).task = 'mutated';
    }).toThrow();
  });

  it('fails closed when required fields are missing or empty', () => {
    expect(() => parseDelegationCapsule({ task: 'only task' })).toThrow(DELEGATION_CAPSULE_ERROR);
    expect(() => parseDelegationCapsule(validCapsule({ mission: '   ' }))).toThrow(/mission/);
    expect(() => parseDelegationCapsule({
      ...validCapsule(),
      acceptedFacts: undefined,
    })).toThrow(/acceptedFacts/);
    expect(() => parseDelegationCapsule({
      ...validCapsule(),
      requiresRdxLease: undefined,
    })).toThrow(/requiresRdxLease/);
    expect(() => parseDelegationCapsule({
      ...validCapsule(),
      budget: { maxToolCalls: 0, maxWallTimeMs: 10 },
    })).toThrow(/maxToolCalls/);
  });

  it('fails closed on invalid input artifact refs', () => {
    expect(() => parseDelegationCapsule(validCapsule({
      inputArtifactRefs: ['../escape'],
    }))).toThrow(/inputArtifactRefs/);
  });

  it('appends capsule segments after an existing PromptPlan', () => {
    const base: PromptPlan = {
      id: 'plan',
      segments: [{
        id: 'runtime:facts',
        kind: 'runtime-fact',
        scope: 'runtime',
        sourcePath: 'runtime://facts',
        sourceHash: 'h',
        precedence: 0,
        content: 'facts',
        stability: 'volatile',
        tokenEstimate: 1,
      }],
      systemPrompt: 'facts',
      totalTokenEstimate: 1,
      stablePrefix: {
        fingerprint: 'fp',
        segmentIds: [],
        sourceHashes: [],
        tokenEstimate: 0,
        volatileSegmentIds: ['runtime:facts'],
      },
      metrics: { systemPrompt: 5, scopedInstructions: 0, skills: 0 },
      diagnostics: [],
    };
    const next = applyDelegationCapsuleToPromptPlan(base, compileDelegationCapsule(validCapsule()));
    expect(next.segments.some((segment) => segment.kind === 'delegation-capsule')).toBe(true);
    expect(next.systemPrompt).toContain('facts');
    expect(next.systemPrompt).toContain('Delegation Task');
    expect(next.stablePrefix.volatileSegmentIds).toContain('delegation:task');
  });
});
