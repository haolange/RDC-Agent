/**
 * Provider wire matrix: 9 adapter surfaces × 16 contract dimensions.
 * Each surface directory is self-contained. Missing fixtures fail the test.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { LlmProviderProtocol } from '@shared/types/settings';
import type { ProviderAdapterId } from '@shared/provider-catalog/implementationRegistry';
import type { ProviderContractBundle } from '@shared/provider-catalog/modelManifestSchema';
import { createTestRequestPlan } from '../createTestRequestPlan';
import { EventStream } from '../../agent-runtime/core/EventStream';
import type { AssistantMessage, AssistantMessageEvent } from '../../agent-runtime/core/types';
import {
  AssistantStreamBuilder,
  createProviderOutputRef,
} from '../../agent-runtime/providers/internal/AssistantStreamBuilder';
import {
  ensureOk,
  parseJsonLines,
  parseSSE,
  ProviderHttpError,
} from '../../agent-runtime/providers/internal/http';
import { requestPlanHeaders } from '../../agent-runtime/providers/requestPlanWire';
import { classifyProviderError } from '../../agent-runtime/providers/internal/errorClassifier';
import { normalizeCacheUsage } from '../../agent-runtime/providers/internal/normalizeCacheUsage';
import { calculateUsageCost } from '../../agent-runtime/providers/internal/costCalculator';

const FIXTURE_ROOT = path.join(__dirname, '../../agent-runtime/providers/__fixtures__');
const PROFILE_ROOT = path.join(__dirname, '../../../shared/provider-catalog/manifests/profiles');
const IMAGE_PART_RE = /image_url|inlineData|inline_data|"type"\s*:\s*"image"|media_type/i;

const SURFACES = [
  { dir: 'openai-compatible', adapterId: 'openai-compatible', protocol: 'OpenAICompatibleChatCompletions', streamFile: 'stream.sse', transport: 'sse' },
  { dir: 'openai-responses', adapterId: 'openai-responses', protocol: 'OpenAIResponses', streamFile: 'stream.sse', transport: 'sse' },
  { dir: 'anthropic', adapterId: 'anthropic-messages', protocol: 'AnthropicMessages', streamFile: 'stream.sse', transport: 'sse' },
  { dir: 'gemini', adapterId: 'google-gemini', protocol: 'GoogleGemini', streamFile: 'stream.sse', transport: 'sse' },
  { dir: 'google-interactions', adapterId: 'google-interactions', protocol: 'GoogleInteractions', streamFile: 'stream.sse', transport: 'sse' },
  { dir: 'ollama', adapterId: 'ollama-openai-compatible', protocol: 'OllamaOpenAICompatibleChatCompletions', streamFile: 'stream.jsonl', transport: 'jsonl' },
  { dir: 'azure-openai-responses', adapterId: 'azure-openai-responses', protocol: 'AzureOpenAIResponses', streamFile: 'stream.sse', transport: 'sse' },
  { dir: 'mistral-conversations', adapterId: 'mistral-conversations', protocol: 'MistralConversations', streamFile: 'stream.sse', transport: 'sse' },
  { dir: 'bedrock-converse-stream', adapterId: 'bedrock-converse-stream', protocol: 'BedrockConverseStream', streamFile: 'stream.sse', transport: 'sse' },
] as const satisfies ReadonlyArray<{
  dir: string;
  adapterId: ProviderAdapterId;
  protocol: LlmProviderProtocol;
  streamFile: string;
  transport: 'sse' | 'jsonl';
}>;

const DIMENSIONS = [
  'plain',
  'streaming',
  'tool_call',
  'tool_result_continuation',
  'reasoning',
  'vision',
  'cache',
  'usage',
  'cost',
  'context_overflow',
  'http_429',
  'http_5xx',
  'abort',
  'malformed_stream',
  'truncated_stream',
  'secret_non_leak',
] as const;

type Surface = (typeof SURFACES)[number];
type SurfaceContract = {
  reasoning: 'none' | 'present';
  vision: 'fail-closed' | 'present';
  cache: 'none' | 'present';
};
type SurfaceHttpError = { status: number; body: string };
type SurfaceErrors = {
  context_overflow: SurfaceHttpError;
  http_429: SurfaceHttpError;
  http_5xx: SurfaceHttpError;
};

function extFor(surface: Surface): 'sse' | 'jsonl' {
  return surface.transport === 'jsonl' ? 'jsonl' : 'sse';
}

function requiredStreamStarFiles(surface: Surface, contract: SurfaceContract): string[] {
  const ext = extFor(surface);
  const files = [
    `stream-truncated.${ext}`,
    `stream-malformed.${ext}`,
    `stream-continuation.${ext}`,
    `stream-reasoning.${ext}`,
  ];
  if (contract.vision === 'present') {
    files.push(`stream-vision.${ext}`);
  }
  return files;
}

function readFixture(surface: Surface, fileName: string): string {
  const filePath = path.join(FIXTURE_ROOT, surface.dir, fileName);
  if (!existsSync(filePath)) {
    throw new Error(`PROVIDER_FIXTURE_MISSING: ${path.join(surface.dir, fileName)}`);
  }
  return readFileSync(filePath, 'utf8');
}

function readContract(surface: Surface): SurfaceContract {
  const raw = JSON.parse(readFixture(surface, 'contract.json')) as SurfaceContract;
  expect(raw.reasoning === 'none' || raw.reasoning === 'present').toBe(true);
  expect(raw.vision === 'fail-closed' || raw.vision === 'present').toBe(true);
  expect(raw.cache === 'none' || raw.cache === 'present').toBe(true);
  return raw;
}

function readErrors(surface: Surface): SurfaceErrors {
  const raw = JSON.parse(readFixture(surface, 'errors.json')) as SurfaceErrors;
  for (const key of ['context_overflow', 'http_429', 'http_5xx'] as const) {
    expect(raw[key]?.status).toBeGreaterThan(0);
    expect(raw[key]?.body).toContain(surface.dir);
  }
  return raw;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function catalogContractsFor(adapterId: string): ProviderContractBundle | null {
  for (const file of readdirSync(PROFILE_ROOT)) {
    if (!file.endsWith('.json')) continue;
    const parsed = JSON.parse(readFileSync(path.join(PROFILE_ROOT, file), 'utf8')) as {
      routeMechanics?: Array<{ adapter?: string; contracts?: ProviderContractBundle }>;
    };
    const match = parsed.routeMechanics?.find((entry) => entry.adapter === adapterId);
    if (match?.contracts) return match.contracts;
  }
  return null;
}

async function parseTransport(
  surface: Surface,
  raw: string,
  providerApi: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const response = new Response(raw, {
    status: 200,
    headers: { 'Content-Type': surface.transport === 'sse' ? 'text/event-stream' : 'application/x-ndjson' },
  });
  const payloads: string[] = [];
  if (surface.transport === 'sse') {
    for await (const data of parseSSE(response, signal, { providerApi })) {
      payloads.push(data);
    }
  } else {
    for await (const line of parseJsonLines(response, signal, { providerApi })) {
      payloads.push(line);
    }
  }
  return payloads;
}

function parsedObjects(payloads: string[]): unknown[] {
  const objects: unknown[] = [];
  for (const payload of payloads) {
    try {
      objects.push(JSON.parse(payload));
    } catch {
      // Incomplete or malformed frames must not become objects.
    }
  }
  return objects;
}

function looksLikeUsage(record: Record<string, unknown>): boolean {
  return (
    'prompt_tokens' in record
    || 'input_tokens' in record
    || 'promptTokenCount' in record
    || 'total_input_tokens' in record
    || 'inputTokens' in record
    || 'prompt_eval_count' in record
  );
}

function numberField(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function extractUsage(value: unknown): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
} | null {
  const record = asRecord(value);
  if (!record) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = extractUsage(item);
        if (found) return found;
      }
    }
    return null;
  }

  const usage = asRecord(record.usage) ?? asRecord(record.usageMetadata) ?? (looksLikeUsage(record) ? record : null);
  if (usage) {
    const details = asRecord(usage.prompt_tokens_details) ?? asRecord(usage.input_tokens_details);
    const inputTokens = numberField(usage, [
      'prompt_tokens',
      'input_tokens',
      'promptTokenCount',
      'total_input_tokens',
      'inputTokens',
      'prompt_eval_count',
    ]);
    const outputTokens = numberField(usage, [
      'completion_tokens',
      'output_tokens',
      'candidatesTokenCount',
      'total_output_tokens',
      'outputTokens',
      'eval_count',
    ]);
    const cacheReadTokens = numberField(details ?? {}, ['cached_tokens'])
      ?? numberField(usage, [
        'cache_read_input_tokens',
        'cachedContentTokenCount',
        'total_cached_tokens',
        'cacheReadInputTokens',
        'prompt_cache_hit_tokens',
      ]);
    if (inputTokens !== undefined || outputTokens !== undefined || cacheReadTokens !== undefined) {
      return {
        inputTokens: inputTokens ?? 0,
        outputTokens: outputTokens ?? 0,
        ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
      };
    }
  }

  for (const nested of Object.values(record)) {
    const found = extractUsage(nested);
    if (found) return found;
  }
  return null;
}

function looksLikeThinking(value: unknown): boolean {
  const blob = typeof value === 'string' ? value : JSON.stringify(value);
  return /reasoning_content|"thinking"|thinking_delta|"thought"|reasoningContent|response\.reasoning/i.test(blob);
}

function unparseableFrames(payloads: string[]): string[] {
  return payloads.filter((entry) => {
    try {
      JSON.parse(entry);
      return false;
    } catch {
      return true;
    }
  });
}

function buildPlan(surface: Surface, contracts?: ProviderContractBundle) {
  return createTestRequestPlan({
    providerId: surface.dir,
    adapterId: surface.adapterId,
    catalogRevision: 'wire-matrix-catalog',
    routeRevision: `wire-matrix-${surface.dir}`,
    selectedModelId: 'fixture',
    effectiveModelId: 'fixture',
    appliedBindingIds: [],
    route: {
      protocol: surface.protocol,
      baseUrl: 'https://example.test/v1',
      source: 'catalog',
      ...(contracts ? { contracts } : {}),
    },
    headers: {
      'x-rdc-activation': 'fixture',
      authorization: 'Bearer sk-fixture-must-not-appear',
      'x-api-key': 'fixture-api-key',
    },
    bodyPatch: {},
    contextBudgetTokens: 128_000,
    contextMode: 'normal',
    contextWindowTokens: 128_000,
    activeTierId: 'default',
    fastMode: false,
    reasoningWire: {
      selection: 'off',
      control: {
        kind: 'none',
        supportsOff: true,
        levels: [],
        defaultSelection: 'off',
        wireProfile: { kind: 'none' },
      },
    },
  });
}

function collectStreamStarFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectStreamStarFiles(full, acc);
      continue;
    }
    if (entry.startsWith('stream-')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('provider wire 9×16 matrix', () => {
  it('covers every required surface, dimension, and per-directory fixture', () => {
    expect(SURFACES).toHaveLength(9);
    expect(DIMENSIONS).toHaveLength(16);
    const requiredAbs = new Set<string>();
    for (const surface of SURFACES) {
      expect(existsSync(path.join(FIXTURE_ROOT, surface.dir, surface.streamFile))).toBe(true);
      const contract = readContract(surface);
      readErrors(surface);
      expect(catalogContractsFor(surface.adapterId), surface.adapterId).not.toBeNull();
      for (const fileName of requiredStreamStarFiles(surface, contract)) {
        const abs = path.join(FIXTURE_ROOT, surface.dir, fileName);
        expect(existsSync(abs), abs).toBe(true);
        readFileSync(abs, 'utf8');
        requiredAbs.add(path.normalize(abs));
      }
    }
    const present = collectStreamStarFiles(FIXTURE_ROOT).map((file) => path.normalize(file));
    const unreferenced = present.filter((file) => !requiredAbs.has(file));
    expect(unreferenced).toEqual([]);
  });

  for (const surface of SURFACES) {
    describe(surface.dir, () => {
      for (const dimension of DIMENSIONS) {
        it(dimension, async () => {
          const payloads = await parseTransport(
            surface,
            readFixture(surface, surface.streamFile),
            surface.adapterId,
          );
          const blob = payloads.join('\n');
          const objects = parsedObjects(payloads);
          const plan = buildPlan(surface, catalogContractsFor(surface.adapterId) ?? undefined);

          switch (dimension) {
            case 'plain':
              expect(blob).toMatch(/Hello|world|text/i);
              break;
            case 'streaming':
              expect(payloads.length).toBeGreaterThan(1);
              break;
            case 'tool_call':
              expect(blob).toMatch(/read_file|toolUse|function_call|tool_calls|tool_use/);
              break;
            case 'tool_result_continuation': {
              const continuationRaw = readFixture(surface, `stream-continuation.${extFor(surface)}`);
              const continuation = await parseTransport(surface, continuationRaw, surface.adapterId);
              expect(continuation.join('\n')).toMatch(/continued after tool/i);
              expect(continuation.join('\n')).toMatch(/tool_result|toolResult|function\.output|tool_use|toolUse|function_call|functionCall|tool_calls/i);
              break;
            }
            case 'reasoning': {
              const contract = readContract(surface);
              const reasoningRaw = readFixture(surface, `stream-reasoning.${extFor(surface)}`);
              const reasoningPayloads = await parseTransport(surface, reasoningRaw, surface.adapterId);
              const reasoningObjects = parsedObjects(reasoningPayloads);
              if (contract.reasoning === 'present') {
                expect(looksLikeThinking(reasoningRaw)).toBe(true);
                expect(reasoningObjects.some(looksLikeThinking)).toBe(true);
              } else {
                expect(looksLikeThinking(reasoningRaw)).toBe(false);
                expect(reasoningObjects.some(looksLikeThinking)).toBe(false);
              }
              break;
            }
            case 'vision': {
              const contract = readContract(surface);
              const catalog = catalogContractsFor(surface.adapterId);
              if (!catalog) {
                throw new Error(`PROVIDER_CATALOG_CONTRACTS_MISSING: ${surface.adapterId}`);
              }
              expect(catalog.semanticContext.attachments).toBe(contract.vision);
              const fixtureText = [
                readFixture(surface, surface.streamFile),
                ...requiredStreamStarFiles(surface, contract).map((fileName) => readFixture(surface, fileName)),
              ].join('\n');
              if (contract.vision === 'present') {
                const visionRaw = readFixture(surface, `stream-vision.${extFor(surface)}`);
                expect(visionRaw).toMatch(IMAGE_PART_RE);
              } else {
                expect(fixtureText).not.toMatch(IMAGE_PART_RE);
                expect(existsSync(path.join(FIXTURE_ROOT, surface.dir, `stream-vision.${extFor(surface)}`))).toBe(false);
              }
              break;
            }
            case 'cache': {
              const contract = readContract(surface);
              const usage = extractUsage(objects);
              expect(usage).toBeTruthy();
              if (contract.cache === 'present') {
                expect(usage!.cacheReadTokens).toBeGreaterThan(0);
                const normalized = normalizeCacheUsage({
                  inputTokens: usage!.inputTokens,
                  cacheReadTokens: usage!.cacheReadTokens,
                });
                expect(normalized.cacheMissTokens).toBe(Math.max(usage!.inputTokens - usage!.cacheReadTokens!, 0));
                expect(normalized.cacheHitTokens).toBeGreaterThan(0);
              } else {
                expect(usage!.cacheReadTokens).toBeUndefined();
                expect(normalizeCacheUsage({ inputTokens: usage!.inputTokens })).toEqual({});
              }
              break;
            }
            case 'usage':
              expect(extractUsage(objects)?.inputTokens).toBeGreaterThan(0);
              expect(blob).toMatch(/usage|token|eval_count|promptToken|inputTokens|output_tokens|total_tokens/i);
              break;
            case 'cost': {
              const usage = extractUsage(objects);
              expect(usage).toBeTruthy();
              const cost = calculateUsageCost({
                cost: { input: 1, output: 2, cacheRead: 0.25, cacheWrite: 0.5 },
              }, {
                inputTokens: usage!.inputTokens,
                outputTokens: usage!.outputTokens,
                totalTokens: usage!.inputTokens + usage!.outputTokens,
                cacheReadTokens: usage!.cacheReadTokens,
              });
              expect(cost).toBeDefined();
              expect(cost!.input).toBe((1 / 1_000_000) * usage!.inputTokens);
              expect(cost!.output).toBe((2 / 1_000_000) * usage!.outputTokens);
              expect(cost!.cacheRead).toBe((0.25 / 1_000_000) * (usage!.cacheReadTokens ?? 0));
              expect(cost!.total).toBe(cost!.input + cost!.output + (cost!.cacheRead ?? 0) + (cost!.cacheWrite ?? 0));
              expect(JSON.stringify(cost)).not.toMatch(/sk-fixture/);
              break;
            }
            case 'context_overflow': {
              const spec = readErrors(surface).context_overflow;
              const classified = classifyProviderError(new Error(spec.body), spec.status);
              expect(classified.code).toBe('context_overflow');
              expect(classified.message).toBe(spec.body);
              break;
            }
            case 'http_429': {
              const spec = readErrors(surface).http_429;
              await expect(ensureOk(new Response(spec.body, { status: spec.status }), surface.adapterId))
                .rejects.toMatchObject({ status: spec.status, providerApi: surface.adapterId } as Partial<ProviderHttpError>);
              const classified = classifyProviderError(new Error(spec.body), spec.status);
              expect(classified.code).toBe('rate_limit');
              expect(classified.message).toBe(spec.body);
              break;
            }
            case 'http_5xx': {
              const spec = readErrors(surface).http_5xx;
              await expect(ensureOk(new Response(spec.body, { status: spec.status }), surface.adapterId))
                .rejects.toMatchObject({ status: spec.status, providerApi: surface.adapterId });
              const classified = classifyProviderError(new Error(spec.body), spec.status);
              expect(classified.retryable).toBe(true);
              expect(classified.message).toBe(spec.body);
              break;
            }
            case 'abort': {
              const controller = new AbortController();
              controller.abort();
              await expect(parseTransport(
                surface,
                readFixture(surface, surface.streamFile),
                surface.adapterId,
                controller.signal,
              )).rejects.toMatchObject({ name: 'AbortError' });
              const stream = new EventStream<string, string>();
              stream.push('early');
              stream.abort();
              stream.push('late');
              const seen: string[] = [];
              await expect(async () => {
                for await (const event of stream) seen.push(event);
              }).rejects.toMatchObject({ name: 'AbortError' });
              expect(seen).toEqual(['early']);
              const builder = new AssistantStreamBuilder(
                new EventStream<AssistantMessageEvent, AssistantMessage>(
                  (event) => event.type === 'done',
                  (event) => (event as Extract<AssistantMessageEvent, { type: 'done' }>).message,
                ),
                'model',
                surface.adapterId,
              );
              builder.start();
              const ref = createProviderOutputRef({
                protocol: surface.adapterId,
                providerBlockKey: 'text:0',
                sourceIndex: 0,
                contentIndex: 0,
              });
              builder.startText(ref);
              const abortErr = new Error(`${surface.adapterId} abort`);
              abortErr.name = 'AbortError';
              builder.fail(abortErr, 'aborted');
              expect(() => builder.appendText(ref, 'late')).toThrow();
              break;
            }
            case 'malformed_stream': {
              const malformedRaw = readFixture(surface, `stream-malformed.${extFor(surface)}`);
              const parsed = await parseTransport(surface, malformedRaw, surface.adapterId);
              const malformedObjects = parsedObjects(parsed);
              expect(unparseableFrames(parsed).length).toBeGreaterThan(0);
              expect(JSON.stringify(malformedObjects)).not.toMatch(/not-json/);
              expect(JSON.stringify(malformedObjects)).toMatch(/ok|world|Hello/i);
              break;
            }
            case 'truncated_stream': {
              const truncatedRaw = readFixture(surface, `stream-truncated.${extFor(surface)}`);
              const parsed = await parseTransport(surface, truncatedRaw, surface.adapterId);
              const truncatedObjects = parsedObjects(parsed);
              expect(JSON.stringify(truncatedObjects)).toMatch(/ok/i);
              expect(JSON.stringify(truncatedObjects)).not.toMatch(/incomplete/);
              expect(unparseableFrames(parsed).length).toBeGreaterThan(0);
              break;
            }
            case 'secret_non_leak': {
              const headers = requestPlanHeaders(plan);
              expect(headers.authorization).toBeUndefined();
              expect(JSON.stringify(headers)).not.toMatch(/sk-fixture|fixture-api-key/);
              const contract = readContract(surface);
              const fixtureText = [
                readFixture(surface, surface.streamFile),
                ...requiredStreamStarFiles(surface, contract).map((fileName) => readFixture(surface, fileName)),
                readFixture(surface, 'contract.json'),
                readFixture(surface, 'errors.json'),
              ].join('\n');
              expect(fixtureText).not.toMatch(/sk-fixture/);
              expect(blob).not.toMatch(/sk-fixture-must-not-appear/);
              break;
            }
            default:
              throw new Error(`unhandled dimension ${dimension}`);
          }
        });
      }
    });
  }
});
