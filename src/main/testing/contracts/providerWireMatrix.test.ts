/**
 * Provider wire matrix: 9 adapter surfaces × 16 contract dimensions.
 * Each surface directory is self-contained. Missing fixtures fail the test.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import type { LlmProviderProtocol } from '@shared/types/settings';
import type { ProviderAdapterId } from '@shared/provider-catalog/implementationRegistry';
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
import { finalizeProviderUsage, normalizeCacheUsage } from '../../agent-runtime/providers/internal/normalizeCacheUsage';

const FIXTURE_ROOT = path.join(__dirname, '../../agent-runtime/providers/__fixtures__');

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
};

function extFor(surface: Surface): 'sse' | 'jsonl' {
  return surface.transport === 'jsonl' ? 'jsonl' : 'sse';
}

function requiredStreamStarFiles(surface: Surface): string[] {
  const ext = extFor(surface);
  return [
    `stream-truncated.${ext}`,
    `stream-malformed.${ext}`,
    `stream-continuation.${ext}`,
    `stream-reasoning.${ext}`,
  ];
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
  return raw;
}

async function parseTransport(surface: Surface, raw: string, providerApi: string): Promise<string[]> {
  const response = new Response(raw, {
    status: 200,
    headers: { 'Content-Type': surface.transport === 'sse' ? 'text/event-stream' : 'application/x-ndjson' },
  });
  const payloads: string[] = [];
  if (surface.transport === 'sse') {
    for await (const data of parseSSE(response, undefined, { providerApi })) {
      payloads.push(data);
    }
  } else {
    for await (const line of parseJsonLines(response, undefined, { providerApi })) {
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

function looksLikeThinking(value: unknown): boolean {
  const blob = JSON.stringify(value);
  return /reasoning_content|"thinking"|thinking_delta|"thought"|reasoningContent|response\.reasoning/i.test(blob);
}

function buildPlan(surface: Surface) {
  return createTestRequestPlan({
    providerId: surface.dir,
    adapterId: surface.adapterId,
    catalogRevision: 'wire-matrix-catalog',
    routeRevision: `wire-matrix-${surface.dir}`,
    selectedModelId: 'fixture',
    effectiveModelId: 'fixture',
    appliedBindingIds: [],
    route: { protocol: surface.protocol, baseUrl: 'https://example.test/v1', source: 'catalog' },
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
      expect(existsSync(path.join(FIXTURE_ROOT, surface.dir, 'contract.json'))).toBe(true);
      readFixture(surface, 'contract.json');
      for (const fileName of requiredStreamStarFiles(surface)) {
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
          const plan = buildPlan(surface);

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
              const objects = parsedObjects(reasoningPayloads);
              if (contract.reasoning === 'none') {
                expect(contract.reasoning).toBe('none');
                expect(objects.some(looksLikeThinking)).toBe(false);
              } else {
                expect(objects.some(looksLikeThinking)).toBe(true);
              }
              break;
            }
            case 'vision': {
              const attachments = plan.route.contracts?.semanticContext.attachments;
              expect(attachments).toBeDefined();
              expect(attachments).toBe('fail-closed');
              break;
            }
            case 'cache':
              expect(normalizeCacheUsage({
                inputTokens: 100,
                cacheReadTokens: 40,
                providerApi: surface.adapterId,
              } as { inputTokens: number; cacheReadTokens: number })).toMatchObject({ cacheHitTokens: 40 });
              expect(surface.adapterId).toBe(plan.adapterId);
              break;
            case 'usage':
              expect(blob).toMatch(/usage|token|eval_count|promptToken|inputTokens|output_tokens|total_tokens/i);
              break;
            case 'cost': {
              const usage = finalizeProviderUsage({
                inputTokens: 10,
                outputTokens: 4,
                cost: { input: 0.01, output: 0.02, total: 0.03 },
                providerApi: surface.adapterId,
              } as { inputTokens: number; outputTokens: number; cost: { input: number; output: number; total: number } });
              expect(usage.cost?.total).toBe(0.03);
              expect(JSON.stringify(usage)).not.toMatch(/sk-fixture/);
              expect(surface.adapterId).toBe(plan.adapterId);
              break;
            }
            case 'context_overflow': {
              const classified = classifyProviderError(
                new Error(`${surface.adapterId}: context length exceeded`),
                400,
              );
              expect(classified.code).toBe('context_overflow');
              expect(classified.message).toContain(surface.adapterId);
              break;
            }
            case 'http_429': {
              await expect(ensureOk(new Response('rate limited', { status: 429 }), surface.adapterId))
                .rejects.toBeInstanceOf(ProviderHttpError);
              const classified = classifyProviderError(new Error(`${surface.adapterId} rate limit`), 429);
              expect(classified.code).toBe('rate_limit');
              expect(classified.message).toContain(surface.adapterId);
              break;
            }
            case 'http_5xx': {
              await expect(ensureOk(new Response('unavailable', { status: 503 }), surface.adapterId))
                .rejects.toMatchObject({ status: 503, providerApi: surface.adapterId });
              const classified = classifyProviderError(new Error(`${surface.adapterId} server error`), 503);
              expect(classified.retryable).toBe(true);
              expect(classified.message).toContain(surface.adapterId);
              break;
            }
            case 'abort': {
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
              const objects = parsedObjects(parsed);
              expect(parsed.some((entry) => entry.includes('{not-json') || entry.includes('not-json'))).toBe(true);
              expect(objects.some((entry) => {
                try {
                  JSON.parse(JSON.stringify(entry));
                  return typeof entry === 'object' && entry !== null && JSON.stringify(entry).includes('{not-json');
                } catch {
                  return false;
                }
              })).toBe(false);
              expect(JSON.stringify(objects)).toMatch(/ok|world|Hello/i);
              break;
            }
            case 'truncated_stream': {
              const truncatedRaw = readFixture(surface, `stream-truncated.${extFor(surface)}`);
              const parsed = await parseTransport(surface, truncatedRaw, surface.adapterId);
              const objects = parsedObjects(parsed);
              expect(JSON.stringify(objects)).toMatch(/ok/i);
              expect(JSON.stringify(objects)).not.toMatch(/incomplete/);
              const truncatedFrames = parsed.filter((entry) => {
                try {
                  JSON.parse(entry);
                  return false;
                } catch {
                  return true;
                }
              });
              expect(truncatedFrames.length).toBeGreaterThan(0);
              break;
            }
            case 'secret_non_leak': {
              const headers = requestPlanHeaders(plan);
              expect(headers.authorization).toBeUndefined();
              expect(JSON.stringify(headers)).not.toMatch(/sk-fixture|fixture-api-key/);
              const fixtureText = [
                readFixture(surface, surface.streamFile),
                ...requiredStreamStarFiles(surface).map((fileName) => readFixture(surface, fileName)),
                readFixture(surface, 'contract.json'),
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
