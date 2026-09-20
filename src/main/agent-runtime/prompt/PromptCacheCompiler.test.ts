import { describe, expect, it } from 'vitest';
import type { CachePlan, RequestPlan } from '@shared/types/providerCapability';
import type { PromptPlan } from '@shared/types/rdcRuntime';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';
import { PromptCacheCompiler } from './PromptCacheCompiler';

const promptPlan = (stableContent = 'Stable instructions'): PromptPlan => {
  const volatileContent = 'Current date: 2026-07-19';
  const stableHash = hashScopedResource(stableContent);
  return {
    id: 'prompt-plan',
    segments: [
      {
        id: 'stable',
        kind: 'core-contract',
        scope: 'builtin',
        sourcePath: 'builtin://stable',
        sourceHash: stableHash,
        precedence: 0,
        content: stableContent,
        stability: 'stable',
        tokenEstimate: 4,
      },
      {
        id: 'volatile',
        kind: 'runtime-fact',
        scope: 'runtime',
        sourcePath: 'runtime://facts',
        sourceHash: hashScopedResource(volatileContent),
        precedence: 1,
        content: volatileContent,
        stability: 'volatile',
        tokenEstimate: 6,
      },
    ],
    systemPrompt: stableContent + '\n\n' + volatileContent,
    totalTokenEstimate: 10,
    stablePrefix: {
      fingerprint: hashScopedResource([{ id: 'stable', sourceHash: stableHash, content: stableContent }]),
      segmentIds: ['stable'],
      sourceHashes: [stableHash],
      tokenEstimate: 4,
      volatileSegmentIds: ['volatile'],
    },
    metrics: { systemPrompt: stableContent.length + volatileContent.length + 2, scopedInstructions: 0, skills: 0 },
    diagnostics: [],
  };
};

const requestPlan = (
  cachePlan: CachePlan,
  effectiveModelId = 'model',
  providerId = 'provider',
): RequestPlan => createTestRequestPlan({
  providerId,
  adapterId: 'openai-responses',
  catalogRevision: 'catalog',
  routeRevision: 'route',
  selectedModelId: effectiveModelId,
  effectiveModelId,
  appliedBindingIds: [],
  route: {
    protocol: 'OpenAIResponses',
    baseUrl: 'https://example.test/v1',
    source: 'catalog',
  },
  headers: {},
  bodyPatch: {},
  contextBudgetTokens: 128_000,
  contextMode: 'normal',
  contextWindowTokens: 128_000,
  activeTierId: 'default',
  fastMode: false,
  reasoningWire: {
    selection: 'off',
    control: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
  },
  cachePlan,
});

const openAiCachePlan: CachePlan = {
  enabled: true,
  mode: 'automatic-and-explicit-breakpoints',
  keyCarrier: 'prompt-cache-key',
  breakpointCarrier: 'openai-prompt-cache',
  telemetry: ['cached-input-tokens', 'cache-write-input-tokens'],
  ttl: 'thirty-minutes',
};

describe('PromptCacheCompiler', () => {
  it('keeps request routing keys stable for the same frozen prefix and tools', () => {
    const compiler = new PromptCacheCompiler();
    const first = compiler.compile({
      promptPlan: promptPlan(),
      requestPlan: requestPlan(openAiCachePlan),
      tools: [{ name: 'read_file' }],
    });
    const second = compiler.compile({
      promptPlan: promptPlan(),
      requestPlan: requestPlan(openAiCachePlan),
      tools: [{ name: 'read_file' }],
    });
    expect(first.requestKey).toBe(second.requestKey);
    expect(first).toMatchObject({
      enabled: true,
      breakpoint: 'automatic-and-explicit',
      breakpointCarrier: 'openai-prompt-cache',
      ttl: 'thirty-minutes',
    });
  });

  it('changes the prefix identity for stable prompt, tool, or model changes', () => {
    const compiler = new PromptCacheCompiler();
    const compile = (plan: PromptPlan, request: RequestPlan, tools: unknown[]) =>
      compiler.compile({ promptPlan: plan, requestPlan: request, tools }).prefixFingerprint;
    const baseline = compile(promptPlan(), requestPlan(openAiCachePlan), [{ name: 'read_file' }]);
    expect(compile(promptPlan('Changed'), requestPlan(openAiCachePlan), [{ name: 'read_file' }])).not.toBe(baseline);
    expect(compile(promptPlan(), requestPlan(openAiCachePlan), [{ name: 'write_file' }])).not.toBe(baseline);
    expect(compile(promptPlan(), requestPlan(openAiCachePlan, 'other-model'), [{ name: 'read_file' }])).not.toBe(baseline);
  });

  it('compiles Anthropic automatic caching without inventing a request key', () => {
    const cache = new PromptCacheCompiler().compile({
      promptPlan: promptPlan(),
      requestPlan: requestPlan({
        enabled: true,
        mode: 'automatic-breakpoint',
        keyCarrier: 'none',
        breakpointCarrier: 'anthropic-cache-control',
        telemetry: ['cache-read-input-tokens', 'cache-write-input-tokens'],
        ttl: 'five-minutes',
      }),
      tools: [],
    });
    expect(cache).toMatchObject({
      enabled: true,
      breakpoint: 'automatic',
      keyCarrier: 'none',
      breakpointCarrier: 'anthropic-cache-control',
    });
    expect(cache.requestKey).toBeUndefined();
  });

  it('fails closed for unknown cache semantics', () => {
    const cache = new PromptCacheCompiler().compile({
      promptPlan: promptPlan(),
      requestPlan: requestPlan({
        enabled: false,
        mode: 'unknown',
        keyCarrier: 'unknown',
        breakpointCarrier: 'unknown',
        telemetry: [],
        ttl: 'unknown',
      }),
      tools: [],
    });
    expect(cache.enabled).toBe(false);
    expect(cache.breakpoint).toBe('none');
  });
});
