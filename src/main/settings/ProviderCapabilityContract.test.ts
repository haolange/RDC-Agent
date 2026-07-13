import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it, vi } from 'vitest';
import type { LlmProviderEntry, LlmProviderProtocol } from '@shared/types/settings';

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false, decryptString: () => '', encryptString: (value: string) => Buffer.from(value) },
}));

import { buildSeedModelContribution } from './EffectiveModelResolver';

interface FrozenEffectiveModel {
  providerId: string;
  modelId: string;
  protocol: LlmProviderProtocol;
  defaultBudgetTokens: number;
  defaultMaxPromptTokens: number | null;
  maxMaxPromptTokens: number | null;
  maxActivation: string | null;
  fastKind: string;
}

function provider(id: string, protocol: LlmProviderProtocol): LlmProviderEntry {
  return { id, protocol, catalogOwnership: 'app-managed', models: [] } as unknown as LlmProviderEntry;
}

describe('final provider capability contracts', () => {
  it('matches the frozen representative EffectiveModel fixture directly', () => {
    const expected = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/effective-model-contract.json'), 'utf8')) as FrozenEffectiveModel[];
    const actual = expected.map((entry) => {
      const model = buildSeedModelContribution(provider(entry.providerId, entry.protocol), entry.modelId);
      const defaultTier = model.contextTiers?.[0];
      const maxTier = model.contextTiers?.[1];
      return {
        providerId: entry.providerId,
        modelId: entry.modelId,
        protocol: model.route?.protocol,
        defaultBudgetTokens: model.defaultBudgetTokens,
        defaultMaxPromptTokens: defaultTier?.maxPromptTokens ?? null,
        maxMaxPromptTokens: maxTier?.maxPromptTokens ?? null,
        maxActivation: maxTier?.activation?.kind ?? null,
        fastKind: model.fast?.kind,
      };
    });
    expect(actual).toEqual(expected);
  });

  it('keeps every provider fixture in an exercised fixture family', () => {
    const names = readdirSync(resolve(__dirname, 'fixtures/provider-catalogs')).sort();
    expect(names).toEqual([
      'chutes.json', 'cline.json', 'fireworks-ai.json', 'github-models.json', 'grok-account.json',
      'lm-studio.json', 'longcat.json', 'minimax-oauth.json', 'novita-ai.json', 'nvidia-nim.json',
      'ollama-cloud.json', 'opencode-go.json', 'opencode-zen.json', 'openrouter-pkce.json', 'synthetic.json',
      'together-ai.json',
    ]);
  });
});
