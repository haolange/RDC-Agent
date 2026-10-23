import { describe, expect, it } from 'vitest';
import type { PromptPlan } from '@shared/types/rdcRuntime';
import type { ResolvedReasoningSelection } from '@shared/types/modelCapability';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';
import { applyRequestPlanFacts } from './RequestPlanFacts';

const base: PromptPlan = {
  id: 'plan', segments: [{ id: 'core', kind: 'core-contract', scope: 'builtin', sourcePath: 'builtin://core', sourceHash: 'core-hash',
    precedence: 0, content: 'Core contract', stability: 'stable', tokenEstimate: 4 }],
  systemPrompt: 'Core contract', totalTokenEstimate: 4,
  stablePrefix: { fingerprint: 'stable', segmentIds: ['core'], sourceHashes: ['core-hash'], tokenEstimate: 4, volatileSegmentIds: [] },
  metrics: { systemPrompt: 13, scopedInstructions: 0, skills: 0 }, diagnostics: [],
};
function request(selection: ResolvedReasoningSelection['selection']) {
  return createTestRequestPlan({
    providerId: 'provider', adapterId: 'openai-responses', catalogRevision: 'catalog', routeRevision: 'route',
    selectedModelId: 'selected', effectiveModelId: 'effective', appliedBindingIds: [],
    route: { protocol: 'OpenAIResponses', baseUrl: 'https://private.invalid', source: 'catalog' },
    headers: { Authorization: 'credential-do-not-project' }, bodyPatch: { privateSetting: 'private-body-do-not-project' },
    contextBudgetTokens: 10000, contextMode: 'normal', contextWindowTokens: 20000, activeTierId: 'default', fastMode: false,
    reasoningWire: { selection, control: { kind: 'levels', supportsOff: true, levels: ['low', 'high'], defaultSelection: 'high',
      wireProfile: { kind: 'openai-responses', on: 'high', levels: { low: 'low', high: 'high' } } } },
  });
}
describe('RequestPlanFacts', () => {
  it('projects resolved controls and effective identity without projecting credentials or body patches', () => {
    const prepared = applyRequestPlanFacts(base, request('low'));
    expect(prepared.systemPrompt).toContain('Resolved reasoning selection: "low"');
    expect(prepared.systemPrompt).toContain('Selected model ID: "selected"');
    expect(prepared.systemPrompt).toContain('Effective model ID: "effective"');
    for (const hidden of ['credential-do-not-project', 'private-body-do-not-project', 'https://private.invalid']) {
      expect(prepared.systemPrompt).not.toContain(hidden);
    }
    expect(prepared.segments.at(-1)).toMatchObject({ id: 'runtime:request-plan', kind: 'runtime-fact', stability: 'volatile' });
    expect(prepared.stablePrefix.fingerprint).toBe(base.stablePrefix.fingerprint);
    expect(prepared.totalTokenEstimate).toBeGreaterThan(base.totalTokenEstimate);
    expect(base.segments).toHaveLength(1);
  });
  it.each(['off', 'unknown'] as const)('preserves %s rather than inferring an enabled default', (selection) => {
    expect(applyRequestPlanFacts(base, request(selection)).systemPrompt).toContain(`Resolved reasoning selection: "${selection}"`);
  });
  it('replaces a prior projection and changes its hash while retaining the stable prefix', () => {
    const first = applyRequestPlanFacts(base, request('low'));
    expect(applyRequestPlanFacts(first, request('low'))).toEqual(first);
    const next = applyRequestPlanFacts(first, request('high'));
    expect(next.segments.filter(item => item.id === 'runtime:request-plan')).toHaveLength(1);
    expect(next.systemPrompt).not.toContain('Resolved reasoning selection: "low"');
    expect(next.segments.at(-1)?.sourceHash).not.toBe(first.segments.at(-1)?.sourceHash);
    expect(next.stablePrefix.fingerprint).toBe(first.stablePrefix.fingerprint);
    expect(next.stablePrefix.volatileSegmentIds).toEqual(['runtime:request-plan']);
  });
});
