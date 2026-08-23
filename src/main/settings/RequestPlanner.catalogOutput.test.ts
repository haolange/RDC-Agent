import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { compileProviderCatalog } from '@shared/provider-catalog/compiler';
import type { ModelManifest } from '@shared/provider-catalog/modelManifestSchema';
import { loadProviderCatalogManifestInput } from '@shared/provider-catalog/nodeManifestLoader';
import type { EffectiveModel, ModelRoute } from '@shared/types/providerCapability';
import type { LlmProviderProtocol } from '@shared/types/settings';
import { resolveTurnOutputTokens } from '@shared/utils/contextBudget';
import {
  parseDeclarativeCatalog,
  toDeclarativeCatalogContributions,
} from './DeclarativeCatalogDiscovery';
import type { CatalogModelContribution, EffectiveCatalogRequest } from './effectiveCatalogTypes';
import { mergeEffectiveCatalog } from './effectiveCatalogMerge';
import { parseChatGptAccountCatalog } from './LiveProviderCatalogParsers';
import { planModelRequest } from './RequestPlanner';

const compiledCatalog = compileProviderCatalog(loadProviderCatalogManifestInput(
  resolve(__dirname, '../../shared/provider-catalog/manifests'),
));

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(__dirname, 'fixtures/provider-catalogs', name), 'utf8')) as unknown;
}

function compiledToEffective(providerId: string, model: ModelManifest): EffectiveModel {
  return {
    providerId,
    modelId: model.modelId,
    label: model.label,
    aliases: [...model.aliases],
    enabled: true,
    route: model.route,
    routeOptions: model.routeOptions,
    selection: model.selection,
    availability: 'available',
    presencePolicy: model.presencePolicy,
    contextTiers: model.contextTiers,
    defaultBudgetTokens: model.defaultBudgetTokens,
    cacheContract: model.cacheContract,
    controls: {
      fast: model.controls.fast,
      maxContext: model.controls.maxContext,
      reasoning: {
        ...model.controls.reasoning,
        defaultSelection: model.controls.reasoning.defaultSelection ?? 'off',
      },
    },
    executionBindings: model.executionBindings,
    toolCalling: model.toolCalling,
    visionInput: model.visionInput,
    structuredOutput: model.structuredOutput,
    ...(model.fixedTemperature !== undefined ? { fixedTemperature: model.fixedTemperature } : {}),
    ...(model.cost ? { cost: model.cost } : {}),
    provenance: [],
  };
}

function mergeModels(input: {
  providerId: string;
  protocol: LlmProviderProtocol;
  baseUrl: string;
  catalog: CatalogModelContribution[];
  discovery?: CatalogModelContribution[];
  user?: CatalogModelContribution[];
  userOverride?: CatalogModelContribution[];
  catalogOwnership?: EffectiveCatalogRequest['catalogOwnership'];
}): EffectiveModel[] {
  const fallbackRoute: ModelRoute = {
    protocol: input.protocol,
    baseUrl: input.baseUrl,
    source: 'catalog',
  };
  return mergeEffectiveCatalog({
    providerId: input.providerId,
    accountId: `test:${input.providerId}`,
    protocol: input.protocol,
    catalogOwnership: input.catalogOwnership ?? 'app-managed',
    discoveryAuthority: input.discovery ? 'authoritative-list' : 'additive',
    fallbackRoute,
    catalog: {
      source: 'catalog',
      observedAt: '2026-08-22T00:00:00.000Z',
      models: input.catalog,
    },
    ...(input.discovery ? {
      discovery: {
        source: 'discovery',
        observedAt: '2026-08-22T00:00:00.000Z',
        models: input.discovery,
      },
    } : {}),
    ...(input.user ? {
      user: {
        source: 'user',
        observedAt: '2026-08-22T00:00:00.000Z',
        models: input.user,
      },
    } : {}),
    ...(input.userOverride ? {
      userOverride: {
        source: 'user',
        observedAt: '2026-08-22T00:00:00.000Z',
        models: input.userOverride,
      },
    } : {}),
  });
}

function expectSendableOutput(model: EffectiveModel, catalogModels: EffectiveModel[]): void {
  const sendable = { ...model, availability: 'available' as const, enabled: true };
  const result = planModelRequest({
    model: sendable,
    catalogModels: catalogModels.map((entry) => (
      entry.modelId === model.modelId ? sendable : entry
    )),
    requireAgentToolEligibility: false,
  });
  expect(result.ok, `${model.providerId}/${model.modelId} ${result.ok ? '' : result.message}`).toBe(true);
  if (!result.ok) return;
  expect(result.plan.maxOutputTokens).toBeGreaterThan(0);
  expect(result.plan.contextWindowTokens).toBeGreaterThan(0);
  expect(resolveTurnOutputTokens({
    contextWindowTokens: result.plan.contextWindowTokens,
    maxOutputTokens: result.plan.maxOutputTokens,
    promptTokens: 256,
  })).toBeGreaterThan(0);
}

describe('catalog output planning', () => {
  it('plans a positive output cap for every compiled available model with a window', () => {
    const failures: string[] = [];
    for (const [surfaceId, compiled] of compiledCatalog.surfaces) {
      const models = compiled.surface.models
        .filter((model) => model.availability === 'available' && model.defaultBudgetTokens > 0)
        .map((model) => compiledToEffective(surfaceId, model));
      for (const model of models) {
        const result = planModelRequest({
          model,
          catalogModels: models,
          requireAgentToolEligibility: false,
        });
        if (!result.ok) {
          failures.push(`${surfaceId}/${model.modelId}: ${result.code} ${result.message}`);
          continue;
        }
        const turnOutput = resolveTurnOutputTokens({
          contextWindowTokens: result.plan.contextWindowTokens,
          maxOutputTokens: result.plan.maxOutputTokens,
          promptTokens: 256,
        });
        if (result.plan.maxOutputTokens <= 0 || result.plan.contextWindowTokens <= 0 || !turnOutput) {
          failures.push(
            `${surfaceId}/${model.modelId}: maxOutput=${result.plan.maxOutputTokens} window=${result.plan.contextWindowTokens} turn=${turnOutput}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('plans ChatGPT Account live rows that only report an input window', () => {
    const parsed = parseChatGptAccountCatalog({
      models: [{
        slug: 'gpt-5.4-mini',
        visibility: 'list',
        supported_in_api: true,
        context_window: 272_000,
        max_context_window: 272_000,
      }],
    });
    const [model] = mergeModels({
      providerId: 'chatgpt-account',
      protocol: 'OpenAIResponses',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      catalog: parsed.contributions,
    });
    expect(model.contextTiers[0]).not.toHaveProperty('maxOutputTokens');
    expectSendableOutput(model, [model]);
    const planned = planModelRequest({
      model: { ...model, availability: 'available', enabled: true },
      catalogModels: [model],
      requireAgentToolEligibility: false,
    });
    expect(planned).toMatchObject({ ok: true, plan: { maxOutputTokens: 272_000, contextWindowTokens: 272_000 } });
  });

  it('keeps a compiled output cap when live ChatGPT rows omit max_output_tokens', () => {
    const live = parseChatGptAccountCatalog({
      models: [{
        slug: 'gpt-5.4-mini',
        visibility: 'list',
        supported_in_api: true,
        context_window: 272_000,
      }],
    });
    const [model] = mergeModels({
      providerId: 'chatgpt-account',
      protocol: 'OpenAIResponses',
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      catalog: [{
        modelId: 'gpt-5.4-mini',
        availability: 'available',
        contextTiers: [{
          id: 'default',
          label: 'Compiled',
          maxPromptTokens: 256_000,
          maxOutputTokens: 64_000,
          activation: { kind: 'implicit' },
          entitlement: 'granted',
        }],
        defaultBudgetTokens: 256_000,
      }],
      discovery: live.contributions,
    });
    expect(model.contextTiers.find((tier) => tier.id === 'default')).toMatchObject({
      maxPromptTokens: 272_000,
      maxOutputTokens: 64_000,
    });
    expectSendableOutput(model, [model]);
  });

  it('plans declarative /models rows with or without live max_output_tokens', () => {
    const fireworksSurface = compiledCatalog.surfaces.get('fireworks-ai')?.surface;
    const githubSurface = compiledCatalog.surfaces.get('github-models')?.surface;
    if (fireworksSurface?.discovery.strategy?.kind !== 'json-catalog'
      || githubSurface?.discovery.strategy?.kind !== 'json-catalog') {
      throw new Error('Missing declarative discovery fixtures');
    }

    const fireworks = toDeclarativeCatalogContributions(
      parseDeclarativeCatalog(fireworksSurface.discovery.strategy, fixture('fireworks-ai.json')),
      { protocol: fireworksSurface.routes[0].protocol, baseUrl: fireworksSurface.routes[0].baseUrl },
    );
    expect(fireworks[0].contextTiers?.[0]).not.toHaveProperty('maxOutputTokens');
    const [fireworksModel] = mergeModels({
      providerId: 'fireworks-ai',
      protocol: fireworksSurface.routes[0].protocol,
      baseUrl: fireworksSurface.routes[0].baseUrl,
      catalog: fireworks,
    });
    const fireworksPlan = planModelRequest({
      model: { ...fireworksModel, availability: 'available', enabled: true },
      catalogModels: [fireworksModel],
      requireAgentToolEligibility: false,
    });
    expect(fireworksPlan).toMatchObject({
      ok: true,
      plan: { maxOutputTokens: 1_048_576, contextWindowTokens: 1_048_576 },
    });

    const github = toDeclarativeCatalogContributions(
      parseDeclarativeCatalog(githubSurface.discovery.strategy, fixture('github-models.json')),
      { protocol: githubSurface.routes[0].protocol, baseUrl: githubSurface.routes[0].baseUrl },
    );
    expect(github[0].contextTiers?.[0]).toMatchObject({ maxOutputTokens: 32_768 });
    const [githubModel] = mergeModels({
      providerId: 'github-models',
      protocol: githubSurface.routes[0].protocol,
      baseUrl: githubSurface.routes[0].baseUrl,
      catalog: github,
    });
    const githubPlan = planModelRequest({
      model: { ...githubModel, availability: 'available', enabled: true },
      catalogModels: [githubModel],
      requireAgentToolEligibility: false,
    });
    expect(githubPlan).toMatchObject({
      ok: true,
      plan: { maxOutputTokens: 32_768, contextWindowTokens: 1_081_344 },
    });
  });

  it('plans a user-managed custom model that only declares a context window', () => {
    const [model] = mergeModels({
      providerId: 'custom-endpoint',
      protocol: 'OpenAICompatibleChatCompletions',
      baseUrl: 'http://localhost:4312/v1',
      catalogOwnership: 'user-managed',
      catalog: [],
      user: [{
        modelId: 'window-only-custom',
        label: 'Window only',
        availability: 'available',
        contextTiers: [{
          id: 'default',
          label: 'Default',
          maxPromptTokens: 128_000,
          activation: { kind: 'implicit' },
          entitlement: 'unknown',
        }],
        defaultBudgetTokens: 128_000,
      }],
    });
    expect(model.contextTiers[0]).not.toHaveProperty('maxOutputTokens');
    const planned = planModelRequest({
      model: { ...model, availability: 'available', enabled: true },
      catalogModels: [model],
      requireAgentToolEligibility: false,
    });
    expect(planned).toMatchObject({
      ok: true,
      plan: { maxOutputTokens: 128_000, contextWindowTokens: 128_000 },
    });
  });
});
