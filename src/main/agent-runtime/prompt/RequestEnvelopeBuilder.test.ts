import { describe, expect, it } from 'vitest';
import { RequestEnvelopeBuilder } from './RequestEnvelopeBuilder';

describe('RequestEnvelopeBuilder', () => {
  it('redacts credentials, image payloads, and opaque reasoning while retaining request structure', () => {
    const plan = { id: 'plan', segments: [], systemPrompt: 'system', totalTokenEstimate: 1, metrics: { systemPrompt: 6, scopedInstructions: 0, skills: 0 }, diagnostics: [] };
    const snapshot = new RequestEnvelopeBuilder().build({
      promptPlan: plan, callIndex: 1, route: { providerId: 'p', modelId: 'm', protocol: 'OpenAIResponses' },
      requestPlan: { providerId: 'p', effectiveModelId: 'm', route: { protocol: 'OpenAIResponses', baseUrl: 'https://example.test', source: 'preset' }, headers: {}, bodyPatch: {}, contextBudgetTokens: 256_000, contextMode: 'normal', contextWindowTokens: 256_000, activeTierId: 'default', fastMode: false, reasoningWire: { selection: 'off', control: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } } } },
      messages: [{ role: 'user', apiKey: 'secret', content: [{ type: 'image', mimeType: 'image/png', data: 'a'.repeat(500) }] }, { type: 'thinking', kind: 'opaque', visibility: 'hidden', text: 'protected' }],
      tools: [{ name: 'read_file' }], controls: {}, reasoning: { semantic: 'opaque', source: 'provider', displayLabel: 'Reasoning metadata' },
    });
    expect(JSON.stringify(snapshot.messages)).not.toContain('secret');
    expect(JSON.stringify(snapshot.messages)).not.toContain('protected');
    expect(snapshot.redactions.map((entry) => entry.reason)).toEqual(expect.arrayContaining(['credential', 'binary image payload', 'protected opaque reasoning']));
  });
});
