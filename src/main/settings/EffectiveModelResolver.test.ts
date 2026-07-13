import { describe, expect, it, vi } from 'vitest';
import type { LlmProviderEntry } from '@shared/types/settings';

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    decryptString: () => '',
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
  },
}));

import { buildSeedModelContribution } from './EffectiveModelResolver';

function provider(id: string, protocol: LlmProviderEntry['protocol']): LlmProviderEntry {
  return {
    id,
    protocol,
    catalogOwnership: 'app-managed',
    models: [],
  } as unknown as LlmProviderEntry;
}

describe('surface-specific effective model seeds', () => {
  it('keeps ChatGPT on the Codex surface with dynamic context and request-param Fast', () => {
    const model = buildSeedModelContribution(provider('chatgpt-account', 'OpenAIResponses'), 'gpt-5.5');
    expect(model.contextTiers).toEqual([
      { id: 'default', label: 'Codex service limit', activation: { kind: 'implicit' }, entitlement: 'granted' },
    ]);
    expect(model.fast).toEqual({ kind: 'request-param', patch: { service_tier: 'priority' }, entitlement: 'granted', label: 'Fast' });
  });

  it('uses a header-activated unknown 1M tier for Claude Account', () => {
    const model = buildSeedModelContribution(provider('claude-account', 'AnthropicMessages'), 'claude-sonnet-5');
    expect(model.contextTiers?.[1]).toEqual({
      id: 'max', label: '1M context', maxPromptTokens: 1_000_000,
      activation: { kind: 'header', headers: { 'anthropic-beta': 'context-1m-2025-08-07' } },
      entitlement: 'unknown',
    });
  });

  it('uses an implicit granted 1M tier for direct Anthropic modern models', () => {
    const model = buildSeedModelContribution(provider('anthropic', 'AnthropicMessages'), 'claude-sonnet-5');
    expect(model.contextTiers?.[1]).toMatchObject({
      id: 'max', maxPromptTokens: 1_000_000, activation: { kind: 'implicit' }, entitlement: 'granted',
    });
  });

  it('falls back to one conservative Copilot tier without account billing', () => {
    const model = buildSeedModelContribution(provider('github-copilot', 'OpenAICompatibleChatCompletions'), 'gpt-5.5');
    expect(model.contextTiers).toEqual([
      { id: 'default', label: 'Default', maxPromptTokens: 272_000, activation: { kind: 'implicit' }, entitlement: 'granted' },
    ]);
    expect(model.fast).toEqual({ kind: 'unsupported' });
    expect(buildSeedModelContribution(
      provider('github-copilot', 'OpenAICompatibleChatCompletions'),
      'claude-opus-4-8',
    ).fast).toEqual({ kind: 'model-variant', modelId: 'claude-opus-4-8-fast', entitlement: 'granted' });
  });
});
