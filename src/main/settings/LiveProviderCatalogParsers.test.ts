import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import {
  mergeParsedLiveCatalogs,
  parseChatGptAccountCatalog,
  parseClaudeAccountCatalog,
  parseClineCatalog,
  parseGrokAccountCatalog,
  parseGrokBuilderCatalog,
  parseOpenCodeGoCatalog,
} from './LiveProviderCatalogParsers';

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

  it('parses the account-specific ChatGPT Codex catalog without web Pro variants', () => {
    const parsed = parseChatGptAccountCatalog(fixture('chatgpt-account.json'));
    expect(parsed.models.map((model) => model.id)).toEqual(['gpt-5.4', 'gpt-5.6-sol']);
    expect(parsed.contributions.find((model) => model.modelId === 'gpt-5.6-sol')).toMatchObject({
      defaultBudgetTokens: 372_000,
      contextTiers: [{ id: 'default', maxPromptTokens: 372_000 }],
      fast: { kind: 'request-param', entitlement: 'granted' },
      reasoning: { levels: ['low', 'medium', 'high', 'extra', 'max', 'ultra'] },
    });
    expect(parsed.contributions.find((model) => model.modelId === 'gpt-5.4')?.contextTiers).toEqual([
      expect.objectContaining({ id: 'default', maxPromptTokens: 272_000, entitlement: 'granted' }),
      expect.objectContaining({ id: 'max', maxPromptTokens: 1_000_000, entitlement: 'unknown' }),
    ]);
  });

  it('uses the Claude account endpoint only as model-id discovery evidence', () => {
    const parsed = parseClaudeAccountCatalog(fixture('claude-account.json'));
    expect(parsed.models.map((model) => model.id)).toEqual(['claude-opus-4-8', 'claude-sonnet-5']);
    expect(parsed.contributions[0].contextTiers).toBeUndefined();
  });

  it('merges Grok API and Builder surfaces with Builder routes taking precedence', () => {
    const api = parseGrokAccountCatalog(fixture('grok-account.json'));
    const builder = parseGrokBuilderCatalog(fixture('grok-builder.json'));
    const parsed = mergeParsedLiveCatalogs(api, builder);
    expect(parsed.models.map((model) => model.id)).toEqual(['grok-4.3', 'grok-4.5', 'grok-composer-2.5-fast']);
    expect(parsed.contributions.find((model) => model.modelId === 'grok-4.5')).toMatchObject({
      route: { protocol: 'OpenAIResponses', baseUrl: 'https://cli-chat-proxy.grok.com/v1' },
      defaultBudgetTokens: 500_000,
      contextTiers: [{ entitlement: 'granted' }],
      reasoning: { levels: ['high', 'medium', 'low'] },
    });
    expect(parsed.contributions.find((model) => model.modelId === 'grok-4.3')).toMatchObject({
      route: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://api.x.ai/v1' },
      toolCalling: { state: 'supported' },
    });
  });

  it('filters non-agent modalities and canonicalizes proven aliases in live account catalogs', () => {
    const parsed = parseGrokAccountCatalog({ data: [
      { id: 'grok-4.3', context_window: 1_000_000 },
      { id: 'grok-latest', type: 'alias', canonical_id: 'grok-4.3', context_window: 1_000_000 },
      { id: 'grok-image-1', modality: 'image' },
      { id: 'grok-floating', type: 'alias' },
    ] });
    expect(parsed.models).toEqual([{
      id: 'grok-4.3',
      label: 'grok-4.3',
      enabled: true,
      aliases: ['grok-latest'],
    }]);
    expect(parsed.contributions[0].aliases).toEqual(['grok-latest']);
  });
});
