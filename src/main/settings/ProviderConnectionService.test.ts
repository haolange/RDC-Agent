import { beforeAll, describe, expect, it } from 'vitest';
import type { LlmProviderModel } from '@shared/types/settings';
import {
  mergeManagedModelAvailability,
  normalizeDiscoveredModels,
  normalizeCodingPlanModelMatchKey,
  selectSupportedCodingPlanModels,
  resolveCodingPlanModelsUrl,
  resolveGoogleVertexOpenAiBaseUrl,
  resolveGoogleVertexPublisherModelsUrl,
  parseGoogleVertexPublisherModels,
  projectBedrockMantleModelRoutes,
  projectGoogleVertexModelRoutes,
  resolveBedrockResponsesBaseUrl,
  resolveProviderConnectionDraft,
  resolveVolcengineCodingPlanModelsUrl,
} from './ProviderConnectionService';
import {
  createProviderEntryFromCatalog,
  getLoadedProviderSurface,
  loadProviderSurface,
} from '../provider-catalog/ProviderCatalogRegistry';
import fs from 'node:fs';
import path from 'node:path';

const managed = (...ids: string[]): LlmProviderModel[] => ids.map((id) => ({
  id,
  label: id,
  enabled: true,
  availability: 'unknown',
}));

beforeAll(async () => {
  await loadProviderSurface('bailing');
});

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

describe('typed provider connection resolution', () => {
  it('normalizes a Databricks URL-valued host without duplicating the scheme', () => {
    const resolved = resolveProviderConnectionDraft(createProviderEntryFromCatalog('databricks'), {
      connectionValues: {
        DATABRICKS_HOST: 'https://dbc.example.com',
        DATABRICKS_TOKEN: 'dapi-token',
      },
    });
    expect(resolved.baseUrl).toBe('https://dbc.example.com/ai-gateway/mlflow/v1');
    expect(resolved.apiKey).toBe('dapi-token');
  });

  it('expands Snowflake, Bedrock, Vertex and PrivateMode endpoints from typed fields', () => {
    expect(resolveProviderConnectionDraft(createProviderEntryFromCatalog('snowflake-cortex'), {
      connectionValues: { SNOWFLAKE_ACCOUNT: 'org-account', SNOWFLAKE_CORTEX_PAT: 'pat' },
    }).baseUrl).toBe('https://org-account.snowflakecomputing.com/api/v2/cortex/v1');
    expect(resolveProviderConnectionDraft(createProviderEntryFromCatalog('amazon-bedrock'), {
      connectionValues: { AWS_REGION: 'us-east-1', AWS_BEARER_TOKEN_BEDROCK: 'bedrock-key' },
    }).baseUrl).toBe('https://bedrock-mantle.us-east-1.api.aws/v1');
    expect(resolveProviderConnectionDraft(createProviderEntryFromCatalog('amazon-bedrock'), {
      connectionValues: {
        AWS_REGION: 'us-west-2',
        AWS_ACCESS_KEY_ID: 'access-key',
        AWS_SECRET_ACCESS_KEY: 'secret-key',
      },
    })).toMatchObject({
      apiKey: '',
      baseUrl: 'https://bedrock-mantle.us-west-2.api.aws/v1',
    });
    const vertexProvider = createProviderEntryFromCatalog('google-vertex');
    expect(vertexProvider).toMatchObject({
      authMode: 'api-key',
      authModeOptions: ['api-key', 'environment'],
    });
    expect(resolveProviderConnectionDraft(vertexProvider, {
      connectionValues: {
        GOOGLE_VERTEX_PROJECT: 'project-id',
        GOOGLE_VERTEX_LOCATION: 'us-central1',
        GOOGLE_VERTEX_ACCESS_TOKEN: 'oauth-token',
      },
    }).baseUrl).toBe(
      'https://us-central1-aiplatform.googleapis.com/v1/projects/project-id/locations/us-central1/publishers/google',
    );
    expect(resolveProviderConnectionDraft(createProviderEntryFromCatalog('privatemode-ai'), {
      connectionValues: { PRIVATEMODE_ENDPOINT: 'http://localhost:8080/v1', PRIVATEMODE_API_KEY: 'key' },
    }).baseUrl).toBe('http://localhost:8080/v1');
  });

  it('keeps Gemini OpenAI discovery and Anthropic native Model Garden discovery separate', () => {
    expect(resolveGoogleVertexOpenAiBaseUrl(
      'https://us-east5-aiplatform.googleapis.com/v1/projects/p/locations/us-east5/publishers/google',
    )).toBe(
      'https://us-east5-aiplatform.googleapis.com/v1beta1/projects/p/locations/us-east5/endpoints/openapi',
    );
    expect(() => resolveGoogleVertexOpenAiBaseUrl(
      'https://us-east5-aiplatform.googleapis.com/v1/projects/p/locations/us-east5/publishers/anthropic',
    )).toThrow(/does not match/u);
    expect(resolveGoogleVertexPublisherModelsUrl(
      'https://us-east5-aiplatform.googleapis.com/v1/projects/p/locations/us-east5/publishers/anthropic',
      'anthropic',
    )).toBe(
      'https://us-east5-aiplatform.googleapis.com/v1beta1/publishers/anthropic/models?pageSize=1000&listAllVersions=true',
    );
    expect(parseGoogleVertexPublisherModels({
      publisherModels: [
        { name: 'publishers/anthropic/models/claude-sonnet-4-6', versionId: '20260217' },
        { name: 'publishers/google/models/gemini-3.1-pro' },
      ],
    }, 'anthropic')).toEqual([
      expect.objectContaining({
        id: 'claude-sonnet-4-6@20260217',
        availability: 'unknown',
      }),
    ]);
  });

  it('projects model-level Vertex and Bedrock route matrices from proven discovery', () => {
    const vertex = projectGoogleVertexModelRoutes(
      managed('gemini-3.5-pro'),
      'https://us-east5-aiplatform.googleapis.com/v1/projects/p/locations/us-east5/publishers/google',
      'https://us-east5-aiplatform.googleapis.com/v1beta1/projects/p/locations/us-east5/endpoints/openapi',
      'GoogleVertexGemini',
    );
    expect(vertex[0]?.routeOptions?.map((option) => option.id)).toEqual([
      'GoogleVertexGemini',
      'OpenAICompatibleChatCompletions',
    ]);
    const vertexAnthropic = projectGoogleVertexModelRoutes(
      managed('claude-sonnet-4-6@20260217'),
      'https://us-east5-aiplatform.googleapis.com/v1/projects/p/locations/us-east5/publishers/anthropic',
      '',
      'GoogleVertexAnthropic',
    );
    expect(vertexAnthropic[0]?.routeOptions?.map((option) => option.id)).toEqual([
      'GoogleVertexAnthropic',
    ]);

    expect(resolveBedrockResponsesBaseUrl('https://bedrock-mantle.us-east-1.api.aws/v1'))
      .toBe('https://bedrock-mantle.us-east-1.api.aws/openai/v1');
    const bedrock = projectBedrockMantleModelRoutes(
      managed('amazon.nova-pro-v1:0'),
      'https://bedrock-mantle.us-east-1.api.aws/v1',
    );
    expect(bedrock[0]?.routeOptions).toEqual([
      expect.objectContaining({
        id: 'OpenAICompatibleChatCompletions',
        route: expect.objectContaining({ baseUrl: 'https://bedrock-mantle.us-east-1.api.aws/v1' }),
      }),
      expect.objectContaining({
        id: 'OpenAIResponses',
        route: expect.objectContaining({ baseUrl: 'https://bedrock-mantle.us-east-1.api.aws/openai/v1' }),
      }),
    ]);
  });

  it('keeps operation paths out of OpenAI-compatible bases', () => {
    expect(getLoadedProviderSurface('bailing')?.routes[0]?.baseUrl).toBe('https://api.tbox.cn/api/llm/v1');
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
  it('collapses proven discovery aliases into one canonical model row', () => {
    expect(normalizeDiscoveredModels([
      { id: 'vendor-2026-07' },
      { id: 'vendor-latest', type: 'alias', canonical_id: 'vendor-2026-07' },
      { id: 'vendor-floating', type: 'alias' },
    ])).toEqual([{
      id: 'vendor-2026-07',
      label: 'vendor-2026-07',
      enabled: true,
      aliases: ['vendor-latest'],
    }]);
  });

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

  it('keeps the single Kimi primary and internal Fast target when candidate validation returns the base model', () => {
    const models = mergeManagedModelAvailability(
      managed('kimi-for-coding', 'kimi-for-coding-highspeed'),
      [{ id: 'kimi-for-coding', label: 'kimi-for-coding', enabled: true }],
      { preserveMissing: true },
    );

    expect(models.map((model) => model.id)).toEqual([
      'kimi-for-coding',
      'kimi-for-coding-highspeed',
    ]);
    expect(models.every((model) => model.enabled !== false && model.availability !== 'unavailable')).toBe(true);
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
