import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { parseClineCatalog, parseGrokAccountCatalog, parseOpenCodeGoCatalog } from './LiveProviderCatalogParsers';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(__dirname, 'fixtures/provider-catalogs', name), 'utf8'));
}

describe('live-verification provider catalog parsers', () => {
  it('preserves OpenCode Go per-model protocols', () => {
    const parsed = parseOpenCodeGoCatalog(fixture('opencode-go.json'));
    expect(Object.fromEntries(parsed.contributions.map((model) => [model.modelId, model.route?.protocol]))).toEqual({
      'glm-4.7': 'OpenAICompatibleChatCompletions',
      'gpt-5.4': 'OpenAIResponses',
      'minimax-m2.5': 'AnthropicMessages',
    });
    expect(parsed.contributions.every((model) => model.route?.source === 'model')).toBe(true);
  });

  it('uses explicit ClinePass groups as entitlement evidence', () => {
    const parsed = parseClineCatalog(fixture('cline.json'));
    expect(parsed.contributions.find((model) => model.modelId.includes('claude'))?.contextTiers?.[0].entitlement).toBe('granted');
    expect(parsed.contributions.find((model) => model.modelId.includes('gpt'))?.contextTiers?.[0].entitlement).toBe('unknown');
  });

  it('parses Grok only from the account catalog and keeps capability entitlement unknown', () => {
    const parsed = parseGrokAccountCatalog(fixture('grok-account.json'));
    expect(parsed.models.map((model) => model.id)).toEqual(['grok-4.3', 'grok-4.5']);
    expect(parsed.contributions.every((model) => model.contextTiers?.[0].entitlement === 'unknown')).toBe(true);
  });
});
