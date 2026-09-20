import { describe, expect, it } from 'vitest';
import { RequestEnvelopeBuilder } from './RequestEnvelopeBuilder';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';
import type { PromptPlan } from '@shared/types/rdcRuntime';

describe('RequestEnvelopeBuilder', () => {
  it('redacts credentials, image payloads, and opaque reasoning while retaining request structure', () => {
    const plan: PromptPlan = {
      id: 'plan',
      segments: [{
        id: 'core',
        kind: 'core-contract',
        scope: 'builtin',
        sourcePath: 'builtin://core',
        sourceHash: 'core-hash',
        precedence: 1,
        content: 'api_key=sk-examplecredential123456789',
        stability: 'stable',
        tokenEstimate: 1,
      }],
      systemPrompt: 'Authorization: Bearer provider-secret-value',
      totalTokenEstimate: 1,
      stablePrefix: { fingerprint: 'prefix', segmentIds: ['core'], sourceHashes: ['core-hash'], tokenEstimate: 1, volatileSegmentIds: [] },
      metrics: { systemPrompt: 6, scopedInstructions: 0, skills: 0 },
      diagnostics: [],
    };
    const snapshot = new RequestEnvelopeBuilder().build({
      promptPlan: plan, callIndex: 1, route: { providerId: 'p', modelId: 'm', protocol: 'OpenAIResponses' },
      requestPlan: createTestRequestPlan({ providerId: 'p', adapterId: 'openai-responses', catalogRevision: 'test-catalog', routeRevision: 'test-route', selectedModelId: 'm', effectiveModelId: 'm', appliedBindingIds: [], route: { protocol: 'OpenAIResponses', baseUrl: 'https://example.test', source: 'catalog' }, headers: {}, bodyPatch: {}, contextBudgetTokens: 256_000, contextMode: 'normal', contextWindowTokens: 256_000, activeTierId: 'default', fastMode: false, reasoningWire: { selection: 'off', control: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } } } }),
      messages: [
        { role: 'user', apiKey: 'secret', note: 'password=message-secret', content: [{ type: 'image', mimeType: 'image/png', data: 'a'.repeat(500) }] },
        { type: 'thinking', kind: 'opaque', visibility: 'hidden', text: 'protected' },
      ],
      tools: [{ name: 'read_file' }], controls: {}, cache: { enabled: false, mode: 'none', keyCarrier: 'none', breakpointCarrier: 'none', ttl: 'none', breakpoint: 'none', stableSegmentIds: [], stableTokenEstimate: 0, providerReported: false, reason: 'test' }, reasoning: { semantic: 'opaque', source: 'provider', displayLabel: 'Reasoning metadata', carrier: 'opaque-provider-state', artifactFormat: 'provider.opaque', artifactVersion: 'v1', compatibilityGroup: 'test', continuation: 'exact-execution' },
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('message-secret');
    expect(serialized).not.toContain('provider-secret-value');
    expect(serialized).not.toContain('sk-examplecredential123456789');
    expect(JSON.stringify(snapshot.messages)).not.toContain('protected');
    expect(snapshot.promptPlan.systemPrompt).toBe('Authorization: [REDACTED]');
    expect(snapshot.promptPlan.segments[0]?.content).toBe('api_key=[REDACTED]');
    expect(plan.systemPrompt).toBe('Authorization: Bearer provider-secret-value');
    expect(snapshot.redactions.map((entry) => entry.reason)).toEqual(expect.arrayContaining([
      'credential',
      'credential-like text',
      'binary image payload',
      'protected opaque reasoning',
    ]));
  });
});
