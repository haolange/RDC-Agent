import { describe, expect, it } from 'vitest';
import {
  ModelsOverrideSchema,
  ModelOverrideSchema,
  CustomModelSchema,
} from './modelsOverrideSchema';

describe('ModelsOverrideSchema', () => {
  it('accepts a valid minimal override', () => {
    const input = {
      schemaVersion: 1,
      providers: {
        anthropic: {
          modelOverrides: {
            'claude-sonnet-4-20250514': {
              contextWindow: 200000,
              cost: { input: 3, output: 15 },
            },
          },
        },
      },
    };
    const result = ModelsOverrideSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('accepts a valid override with custom models', () => {
    const input = {
      schemaVersion: 1,
      providers: {
        'custom-openai': {
          baseUrl: 'https://api.example.com/v1',
          models: [{
            id: 'my-model',
            name: 'My Custom Model',
            api: 'openai-chat',
            baseUrl: 'https://api.example.com/v1',
            contextWindow: 128000,
            maxTokens: 4096,
          }],
        },
      },
    };
    const result = ModelsOverrideSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      const model = result.data.providers['custom-openai'].models?.[0];
      expect(model?.reasoning).toBe(false);
      expect(model?.input).toEqual(['text']);
    }
  });

  it('rejects wrong schemaVersion', () => {
    const input = { schemaVersion: 2, providers: {} };
    expect(ModelsOverrideSchema.safeParse(input).success).toBe(false);
  });

  it('rejects forbidden fields (security boundary)', () => {
    const input = {
      schemaVersion: 1,
      providers: {
        anthropic: {
          modelOverrides: {
            'claude-sonnet-4-20250514': {
              contextWindow: 200000,
              'route.protocol': 'hacked',
            },
          },
        },
      },
    };
    expect(ModelsOverrideSchema.safeParse(input).success).toBe(false);
  });

  it('rejects authSchemaId override', () => {
    const input = {
      schemaVersion: 1,
      providers: {
        anthropic: {
          modelOverrides: {
            'claude-sonnet-4-20250514': { authSchemaId: 'evil' },
          },
        },
      },
    };
    expect(ModelsOverrideSchema.safeParse(input).success).toBe(false);
  });

  it('rejects adapterId override', () => {
    const input = {
      schemaVersion: 1,
      providers: {
        anthropic: {
          modelOverrides: {
            'claude-sonnet-4-20250514': { adapterId: 'evil' },
          },
        },
      },
    };
    expect(ModelsOverrideSchema.safeParse(input).success).toBe(false);
  });

  it('rejects negative cost values', () => {
    const input = { contextWindow: 100, cost: { input: -1, output: 5 } };
    expect(ModelOverrideSchema.safeParse(input).success).toBe(false);
  });

  it('rejects non-positive contextWindow', () => {
    expect(ModelOverrideSchema.safeParse({ contextWindow: 0 }).success).toBe(false);
    expect(ModelOverrideSchema.safeParse({ contextWindow: -100 }).success).toBe(false);
  });

  it('rejects custom model without required baseUrl', () => {
    const input = {
      id: 'test',
      name: 'Test',
      api: 'openai-chat',
      contextWindow: 1000,
      maxTokens: 100,
    };
    expect(CustomModelSchema.safeParse(input).success).toBe(false);
  });

  it('rejects custom model with invalid baseUrl', () => {
    const input = {
      id: 'test',
      name: 'Test',
      api: 'openai-chat',
      baseUrl: 'not-a-url',
      contextWindow: 1000,
      maxTokens: 100,
    };
    expect(CustomModelSchema.safeParse(input).success).toBe(false);
  });

  it('accepts all valid ModelOverride fields', () => {
    const input = {
      contextWindow: 200000,
      maxTokens: 8192,
      reasoning: true,
      input: ['text', 'image'],
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
      status: 'active',
    };
    const result = ModelOverrideSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it('rejects unknown provider-level fields', () => {
    const input = {
      schemaVersion: 1,
      providers: {
        anthropic: { evilField: true },
      },
    };
    expect(ModelsOverrideSchema.safeParse(input).success).toBe(false);
  });
});
