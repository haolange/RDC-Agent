import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { LlmProviderEntry, LlmProviderProtocol } from '@shared/types/settings';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.TEMP ?? process.env.TMP ?? process.cwd(),
    getAppPath: () => process.cwd(),
  },
  safeStorage: { isEncryptionAvailable: () => false, decryptString: () => '', encryptString: (value: string) => Buffer.from(value) },
}));

import { mergeEffectiveCatalog } from './effectiveCatalogMerge';
import { buildEffectiveCatalogRequest } from './EffectiveModelResolver';
import { resolveContextTierChoices } from '@shared/utils/contextTiers';
import { loadProviderSurface } from '../provider-catalog/ProviderCatalogRegistry';

interface FrozenEffectiveModel {
  providerId: string;
  modelId: string;
  protocol: LlmProviderProtocol;
  defaultBudgetTokens: number;
  normalPromptCapTokens: number | null;
  oneMillionPromptCapTokens: number | null;
  oneMillionActivation: string | null;
  fastState: string;
}

function provider(id: string, protocol: LlmProviderProtocol): LlmProviderEntry {
  return { id, protocol, catalogOwnership: 'app-managed', models: [] } as unknown as LlmProviderEntry;
}

describe('final provider capability contracts', () => {
  beforeAll(async () => {
    const providerIds = (JSON.parse(
      readFileSync(resolve(__dirname, 'fixtures/effective-model-contract.json'), 'utf8'),
    ) as FrozenEffectiveModel[]).map((entry) => entry.providerId);
    await Promise.all([...new Set(providerIds)].map((providerId) => loadProviderSurface(providerId)));
  });

  it('matches the frozen representative EffectiveModel fixture directly', () => {
    const expected = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/effective-model-contract.json'), 'utf8')) as FrozenEffectiveModel[];
    const actual = expected.map((entry) => {
      const models = mergeEffectiveCatalog(buildEffectiveCatalogRequest(provider(entry.providerId, entry.protocol)));
      const model = models.find((candidate) => candidate.modelId === entry.modelId);
      expect(model).toBeDefined();
      if (!model) throw new Error(`Missing frozen model ${entry.providerId}/${entry.modelId}.`);
      const choices = resolveContextTierChoices(model);
      return {
        providerId: entry.providerId,
        modelId: entry.modelId,
        protocol: model?.route.protocol,
        defaultBudgetTokens: model?.defaultBudgetTokens,
        normalPromptCapTokens: choices.normalTier?.maxPromptTokens ?? null,
        oneMillionPromptCapTokens: choices.oneMillionTier?.maxPromptTokens ?? null,
        oneMillionActivation: choices.oneMillionTier?.activation?.kind ?? null,
        fastState: model.controls.fast.state,
      };
    });
    expect(actual).toEqual(expected);
  });

  it('keeps every provider fixture in an exercised fixture family', () => {
    const names = readdirSync(resolve(__dirname, 'fixtures/provider-catalogs')).sort();
    expect(names).toEqual([
      'chatgpt-account.json', 'chutes.json', 'claude-account.json', 'cline-pass.json', 'cline.json', 'fireworks-ai.json',
      'github-models.json', 'grok-account.json', 'grok-builder.json', 'lm-studio.json', 'longcat.json',
      'novita-ai.json', 'nvidia-nim.json', 'ollama-cloud.json', 'opencode-go.json',
      'opencode-zen.json', 'openrouter-pkce.json', 'synthetic.json', 'together-ai.json',
    ]);
  });
});
