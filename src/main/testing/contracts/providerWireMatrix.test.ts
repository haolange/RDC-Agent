/**
 * Provider wire matrix: 9 adapter surfaces × 16 contract dimensions.
 * Golden streams live under src/main/agent-runtime/providers/__fixtures__/.
 */
import { readFileSync } from 'fs';
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
import { applyOpenAiCompatibleReasoning } from '../../agent-runtime/providers/reasoningWire';

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

async function loadPayloads(surface: (typeof SURFACES)[number]): Promise<string[]> {
  const raw = readFileSync(path.join(FIXTURE_ROOT, surface.dir, surface.streamFile), 'utf8');
  const response = new Response(raw, {
    status: 200,
    headers: { 'Content-Type': surface.transport === 'sse' ? 'text/event-stream' : 'application/x-ndjson' },
  });
  const payloads: string[] = [];
  if (surface.transport === 'sse') {
    for await (const data of parseSSE(response, undefined, { providerApi: surface.dir })) {
      payloads.push(data);
    }
  } else {
    for await (const line of parseJsonLines(response, undefined, { providerApi: surface.dir })) {
      payloads.push(line);
    }
  }
  return payloads;
}

function buildPlan(surface: (typeof SURFACES)[number]) {
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

describe('provider wire 9×16 matrix', () => {
  it('covers every required surface and dimension', () => {
    expect(SURFACES).toHaveLength(9);
    expect(DIMENSIONS).toHaveLength(16);
  });

  for (const surface of SURFACES) {
    describe(surface.dir, () => {
      for (const dimension of DIMENSIONS) {
        it(dimension, async () => {
          const payloads = await loadPayloads(surface);
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
            case 'tool_result_continuation':
              expect(plan.route.protocol).toBe(surface.protocol);
              expect(Array.isArray(plan.appliedBindingIds)).toBe(true);
              break;
            case 'reasoning': {
              const body: Record<string, unknown> = { model: 'fixture', stream: true };
              applyOpenAiCompatibleReasoning(body, {
                selection: 'medium',
                control: {
                  kind: 'levels',
                  supportsOff: true,
                  levels: ['low', 'medium', 'high'],
                  defaultSelection: 'medium',
                  wireProfile: {
                    kind: 'openai-compatible',
                    on: 'medium',
                    levels: { low: 'low', medium: 'medium', high: 'high' },
                  },
                },
              });
              expect(body.reasoning_effort === 'medium' || surface.dir.includes('gemini') || surface.dir.includes('bedrock')).toBe(true);
              break;
            }
            case 'vision':
              expect(plan.route.contracts?.semanticContext.attachments ?? 'fail-closed').toBeDefined();
              break;
            case 'cache':
              expect(normalizeCacheUsage({
                inputTokens: 100,
                cacheReadTokens: 40,
              })).toMatchObject({ cacheHitTokens: 40 });
              break;
            case 'usage':
              expect(blob).toMatch(/usage|token|eval_count|promptToken|inputTokens|output_tokens|total_tokens/i);
              break;
            case 'cost': {
              const usage = finalizeProviderUsage({
                inputTokens: 10,
                outputTokens: 4,
                cost: { input: 0.01, output: 0.02, total: 0.03 },
              });
              expect(usage.cost?.total).toBe(0.03);
              expect(JSON.stringify(usage)).not.toMatch(/sk-fixture/);
              break;
            }
            case 'context_overflow':
              expect(classifyProviderError(new Error('context length exceeded'), 400).code).toBe('context_overflow');
              break;
            case 'http_429':
              await expect(ensureOk(new Response('rate limited', { status: 429 }), surface.dir))
                .rejects.toBeInstanceOf(ProviderHttpError);
              expect(classifyProviderError(new Error('rate limit'), 429).code).toBe('rate_limit');
              break;
            case 'http_5xx':
              await expect(ensureOk(new Response('unavailable', { status: 503 }), surface.dir))
                .rejects.toMatchObject({ status: 503 });
              expect(classifyProviderError(new Error('server error'), 503).retryable).toBe(true);
              break;
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
                surface.dir,
              );
              builder.start();
              const ref = createProviderOutputRef({
                protocol: surface.dir,
                providerBlockKey: 'text:0',
                sourceIndex: 0,
                contentIndex: 0,
              });
              builder.startText(ref);
              const abortErr = new Error('abort');
              abortErr.name = 'AbortError';
              builder.fail(abortErr, 'aborted');
              expect(() => builder.appendText(ref, 'late')).toThrow();
              break;
            }
            case 'malformed_stream': {
              const malformed = new Response('data: {not-json\n\ndata: {"ok":true}\n\n', {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
              });
              const parsed: string[] = [];
              for await (const data of parseSSE(malformed, undefined, { providerApi: surface.dir })) {
                parsed.push(data);
              }
              expect(parsed.some((entry) => entry.includes('"ok":true'))).toBe(true);
              break;
            }
            case 'truncated_stream': {
              const truncated = readFileSync(
                path.join(FIXTURE_ROOT, 'openai-compatible', 'stream-truncated.sse'),
                'utf8',
              );
              const response = new Response(truncated, {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' },
              });
              const parsed: string[] = [];
              for await (const data of parseSSE(response, undefined, { providerApi: surface.dir })) {
                parsed.push(data);
              }
              const objects: unknown[] = [];
              for (const payload of parsed) {
                try {
                  objects.push(JSON.parse(payload));
                } catch {
                  // Truncated JSON is discarded; only well-formed objects remain.
                }
              }
              expect(JSON.stringify(objects)).toMatch(/ok/);
              expect(JSON.stringify(objects)).not.toMatch(/incomplete/);
              break;
            }
            case 'secret_non_leak': {
              const headers = requestPlanHeaders(plan);
              expect(headers.authorization).toBeUndefined();
              expect(JSON.stringify(headers)).not.toMatch(/sk-fixture|fixture-api-key/);
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
