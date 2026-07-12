import { describe, expect, it } from 'vitest';
import type { LlmProviderModel } from '@shared/types/settings';
import {
  mergeManagedModelAvailability,
  normalizeCodingPlanModelMatchKey,
  selectSupportedCodingPlanModels,
  resolveCodingPlanModelsUrl,
  resolveVolcengineCodingPlanModelsUrl,
} from './ProviderConnectionService';
import fs from 'node:fs';
import path from 'node:path';

const managed = (...ids: string[]): LlmProviderModel[] => ids.map((id) => ({
  id,
  label: id,
  enabled: true,
  availability: 'unknown',
}));

describe('resolveCodingPlanModelsUrl', () => {
  it('appends /v1/models when the coding base has no /v1 suffix', () => {
    expect(resolveCodingPlanModelsUrl('https://api.kimi.com/coding/')).toBe(
      'https://api.kimi.com/coding/v1/models',
    );
    expect(resolveCodingPlanModelsUrl('https://api.kimi.com/coding')).toBe(
      'https://api.kimi.com/coding/v1/models',
    );
  });

  it('appends /models when the base already ends with /v1', () => {
    expect(resolveCodingPlanModelsUrl('https://api.kimi.com/coding/v1')).toBe(
      'https://api.kimi.com/coding/v1/models',
    );
  });
});

describe('resolveVolcengineCodingPlanModelsUrl', () => {
  it('maps Anthropic and OpenAI Coding Plan bases to /api/coding/v3/models', () => {
    expect(resolveVolcengineCodingPlanModelsUrl('https://ark.cn-beijing.volces.com/api/coding')).toBe(
      'https://ark.cn-beijing.volces.com/api/coding/v3/models',
    );
    expect(resolveVolcengineCodingPlanModelsUrl('https://ark.cn-beijing.volces.com/api/coding/v3')).toBe(
      'https://ark.cn-beijing.volces.com/api/coding/v3/models',
    );
    expect(resolveVolcengineCodingPlanModelsUrl('https://ark.cn-beijing.volces.com/api/coding/v3/')).toBe(
      'https://ark.cn-beijing.volces.com/api/coding/v3/models',
    );
  });
});

describe('coding-plan Anthropic discovery routing', () => {
  it('routes volcengine-coding-plan discovery through validateCodingPlanModels for both protocols', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'ProviderConnectionService.ts'),
      'utf8',
    );
    expect(source).toMatch(
      /provider\.id === 'kimi-coding-plan'[\s\S]*provider\.id === 'volcengine-coding-plan'/,
    );
    expect(source).not.toMatch(
      /provider\.id === 'volcengine-coding-plan'[\s\S]*&& provider\.protocol === 'AnthropicMessages'/,
    );
    expect(source).toContain('resolveVolcengineCodingPlanModelsUrl');
    expect(source).toContain('validateCodingPlanModels');
    expect(source).toContain('selectSupportedCodingPlanModels');
  });
});

describe('mergeManagedModelAvailability', () => {
  it('keeps app-managed catalog rows and disables models missing from the endpoint', () => {
    const models = mergeManagedModelAvailability(
      managed('kimi-for-coding', 'catalog-only-model'),
      [{ id: 'kimi-for-coding', label: 'kimi-for-coding', enabled: true }],
    );

    expect(models).toEqual([
      expect.objectContaining({
        id: 'kimi-for-coding',
        enabled: true,
        availability: 'available',
        availabilityReason: undefined,
      }),
      expect.objectContaining({
        id: 'catalog-only-model',
        enabled: false,
        availability: 'unavailable',
      }),
    ]);
  });

  it('treats catalog aliases as available when the endpoint returns the alias id', () => {
    const models = mergeManagedModelAvailability(
      managed('glm-5.2', 'minimax-m2.7'),
      [{ id: 'glm-latest', label: 'glm-latest', enabled: true }],
      {
        aliasesByModelId: new Map([
          ['glm-5.2', ['glm-latest']],
          ['minimax-m2.7', ['MiniMax-M2.7']],
        ]),
      },
    );

    expect(models).toEqual([
      expect.objectContaining({ id: 'glm-5.2', enabled: true, availability: 'available' }),
      expect.objectContaining({ id: 'minimax-m2.7', enabled: false, availability: 'unavailable' }),
    ]);
  });

  it('matches Volcengine date-suffixed /models ids to friendly catalog ids', () => {
    const models = mergeManagedModelAvailability(
      managed('doubao-seed-2.0-code', 'doubao-seed-2.0-pro', 'glm-4.7', 'deepseek-v3.2', 'missing-model'),
      [
        { id: 'doubao-seed-2-0-code-preview-260215', label: 'doubao-seed-2-0-code-preview-260215', enabled: true },
        { id: 'doubao-seed-2-0-pro-260215', label: 'doubao-seed-2-0-pro-260215', enabled: true },
        { id: 'glm-4-7-251222', label: 'glm-4-7-251222', enabled: true },
        { id: 'deepseek-v3-2-251201', label: 'deepseek-v3-2-251201', enabled: true },
      ],
    );

    expect(models.filter((model) => model.enabled !== false).map((model) => model.id)).toEqual([
      'doubao-seed-2.0-code',
      'doubao-seed-2.0-pro',
      'glm-4.7',
      'deepseek-v3.2',
    ]);
    expect(models.find((model) => model.id === 'missing-model')).toMatchObject({
      enabled: false,
      availability: 'unavailable',
    });
  });

  it('matches vendor-prefixed and mini→lite Coding Plan list ids', () => {
    const models = mergeManagedModelAvailability(
      managed('doubao-seed-2.0-pro', 'doubao-seed-2.0-lite'),
      [
        { id: 'volcengine/doubao-seed-2-0-pro-260215', label: 'volcengine/doubao-seed-2-0-pro-260215', enabled: true },
        { id: 'doubao-seed-2-0-mini-260215', label: 'doubao-seed-2-0-mini-260215', enabled: true },
      ],
    );
    expect(models.every((model) => model.enabled && model.availability === 'available')).toBe(true);
  });

  it('normalizes Coding Plan match keys by stripping prefixes, date suffixes and dots', () => {
    expect(normalizeCodingPlanModelMatchKey('doubao-seed-2.0-code')).toBe('doubao-seed-2-0-code');
    expect(normalizeCodingPlanModelMatchKey('doubao-seed-2-0-code-preview-260215')).toBe('doubao-seed-2-0-code');
    expect(normalizeCodingPlanModelMatchKey('volcengine/doubao-seed-2-0-pro-260215')).toBe('doubao-seed-2-0-pro');
    expect(normalizeCodingPlanModelMatchKey('doubao-seed-2-0-mini-260215')).toBe('doubao-seed-2-0-lite');
    expect(normalizeCodingPlanModelMatchKey('glm-4.7')).toBe('glm-4-7');
    expect(normalizeCodingPlanModelMatchKey('glm-4-7-251222')).toBe('glm-4-7');
  });

  it('explains meta-only discovery when the endpoint returns ark-code-latest style ids', () => {
    const models = mergeManagedModelAvailability(
      managed('glm-5.2'),
      [{ id: 'ark-code-latest', label: 'ark-code-latest', enabled: true }],
    );
    expect(models[0]).toMatchObject({
      id: 'glm-5.2',
      enabled: false,
      availability: 'unavailable',
    });
    expect(models[0]?.availabilityReason).toMatch(/meta model/i);
  });

  it('hides Volcengine catalog models that were not confirmed by discovery', () => {
    const models = mergeManagedModelAvailability(
      managed('doubao-seed-2.0-code', 'glm-5.2'),
      [{ id: 'ark-code-latest', label: 'ark-code-latest', enabled: true }],
    );
    expect(selectSupportedCodingPlanModels('volcengine-coding-plan', models)).toEqual([]);
    expect(selectSupportedCodingPlanModels('kimi-coding-plan', models)).toEqual(models);
  });

  it('keeps the catalog unchanged when no live model list is available', () => {
    expect(mergeManagedModelAvailability(managed('gpt-5.5'), [])).toEqual([
      expect.objectContaining({
        id: 'gpt-5.5',
        enabled: true,
        availability: 'unknown',
      }),
    ]);
  });
});
