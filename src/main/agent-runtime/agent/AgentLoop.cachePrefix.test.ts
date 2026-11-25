import { expect, it } from 'vitest';
import { EventStream } from '../core/EventStream';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';
import { promptCacheCompiler } from '../prompt/PromptCacheCompiler';
import * as responses from '../providers/OpenAIResponsesProvider';
import { promptCacheHeaders } from '../providers/promptCacheWire';
import { agentLoop, type AgentContext } from './AgentLoop';
import type { AssistantMessage, AssistantMessageEvent, Context, Model, ToolResultMessage } from '../core/types';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type { PromptPlan } from '@shared/types/rdcRuntime';

const model: Model = { id: 'gpt-test', name: 'GPT test', provider: 'chatgpt-account', api: 'openai-responses',
  contextWindow: 400_000, maxTokens: 8_000, reasoning: false, vision: false };

const requestPlan = createTestRequestPlan({
  providerId: model.provider, adapterId: 'openai-responses', catalogRevision: 'c', routeRevision: 'r',
  selectedModelId: model.id, effectiveModelId: model.id, appliedBindingIds: [],
  route: { protocol: 'OpenAIResponses', baseUrl: 'https://example.test', source: 'catalog' },
  headers: {}, bodyPatch: {}, contextBudgetTokens: 400_000, contextMode: 'normal', contextWindowTokens: 400_000,
  activeTierId: 'default', fastMode: false,
  reasoningWire: { selection: 'off', control: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } } },
  cachePlan: { enabled: true, mode: 'implicit-prefix', keyCarrier: 'session-id-and-prompt-cache-key',
    breakpointCarrier: 'provider-managed', telemetry: ['cached-input-tokens'], ttl: 'provider-managed' },
});

const segment = (id: string, content: string, stability: 'stable' | 'volatile') => ({
  id, kind: 'core-contract' as const, scope: 'builtin' as const, sourcePath: id, sourceHash: id, precedence: 0, content, stability, tokenEstimate: 1,
});
const promptPlan = {
  id: 'plan', segments: [segment('core', 'Investigate carefully.', 'stable'), segment('runtime:facts', 'Date: 2026-11-19', 'volatile')],
  systemPrompt: 'Investigate carefully.\n\nDate: 2026-11-19', totalTokenEstimate: 2,
  stablePrefix: { segmentIds: ['core'], volatileSegmentIds: ['runtime:facts'], fingerprint: 'core', tokenEstimate: 1 },
  metrics: { systemPrompt: 1, scopedInstructions: 0, skills: 0 }, diagnostics: [],
} as unknown as PromptPlan;

function reply(step: number, toolCall: boolean): EventStream<AssistantMessageEvent, AssistantMessage> {
  const message: AssistantMessage = {
    role: 'assistant', model: model.id, provider: model.provider, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, timestamp: step,
    content: toolCall ? [{ type: 'toolCall', id: `call-${step}`, name: 'read_file', arguments: { path: `f${step}` } }] : [{ type: 'text', text: 'done' }],
    stopReason: toolCall ? 'toolUse' : 'stop',
  };
  const stream = new EventStream<AssistantMessageEvent, AssistantMessage>();
  void Promise.resolve().then(() => { stream.push({ type: 'done', reason: message.stopReason, message }); stream.complete(message); });
  return stream;
}

/** The order a provider builds its cached prefix from: tools, instructions, then input items. */
function canonicalItems(context: Context, promptCache: ReturnType<typeof promptCacheCompiler.compile>): string[] {
  const body = responses.buildRequestBody(model, context, { requestPlan, promptCache }) as { tools?: unknown; instructions?: string; input: unknown[] };
  return [JSON.stringify(body.tools ?? []), body.instructions ?? '', ...body.input.map(item => JSON.stringify(item))];
}

it('keeps every request a byte-identical extension of the previous one up to its request-local tail', async () => {
  const promptCache = promptCacheCompiler.compile({ promptPlan, requestPlan, tools: [], affinityScopeId: 'sess_cache_prefix' });
  const requests: Context[] = [];
  let terminalChecks = 0;
  const provider: ProviderStrategy = { api: model.api, stream: (_model, context) => {
    requests.push(structuredClone(context));
    return reply(requests.length, requests.length !== 3 && requests.length !== 5);
  } };
  const context: AgentContext = {
    systemPrompt: promptPlan.systemPrompt, systemPromptSegments: promptPlan.segments,
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Find the cause.' }], timestamp: 0 }],
    tools: [{ name: 'read_file', description: 'Read a file.', parameters: { type: 'object', properties: { path: { type: 'string' } } } }],
  };
  const executor = { async execute(call: { id: string; name: string }): Promise<ToolResultMessage> {
    return { role: 'toolResult', toolCallId: call.id, toolName: call.name, content: [{ type: 'text', text: `contents of ${call.id}` }], isError: false, timestamp: 0 };
  } };
  const { stream } = agentLoop([], context, {
    model, convertToLlm: messages => messages as never, streamOptions: { requestPlan, promptCache }, maxTurns: 6,
    resolvePermissionState: () => ({ mode: 'auto-review', revision: 3 }) as never,
    // The first terminal answer is sent back once, as a runtime continuation.
    beforeTerminalResponse: async () => (terminalChecks++ === 0 ? 'Approved check is still open.' : undefined),
  }, provider, executor);
  for await (const _event of stream) { /* drain */ }

  expect(requests.length).toBeGreaterThanOrEqual(5);
  const sequences = requests.map(request => canonicalItems(request, promptCache));
  const isTail = (item: string) => item.includes('runtime_turn_budget') || item.includes('Approved check is still open.');
  for (let index = 1; index < sequences.length; index += 1) {
    const previous = sequences[index - 1];
    const stable = isTail(previous.at(-1)!) ? previous.slice(0, -1) : previous;
    expect(sequences[index].slice(0, stable.length).join('\u0000')).toBe(stable.join('\u0000'));
  }
  expect(sequences[3].at(-1)).toContain('Approved check is still open.');
  expect(new Set(requests.map(request => request.systemPrompt)).size).toBe(1);

  const body = responses.buildRequestBody(model, requests[0], { requestPlan, promptCache }) as { prompt_cache_key?: string };
  expect(body.prompt_cache_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  expect(promptCacheHeaders(promptCache)).toEqual({ 'session-id': body.prompt_cache_key });
  const otherScope = promptCacheCompiler.compile({ promptPlan, requestPlan, tools: [{ name: 'more' }], affinityScopeId: 'sess_cache_prefix' });
  expect(otherScope.requestKey).toBe(promptCache.requestKey);
  expect(promptCacheCompiler.compile({ promptPlan, requestPlan, tools: [], affinityScopeId: 'sess_other' }).requestKey).not.toBe(promptCache.requestKey);
  expect(promptCacheCompiler.compile({ promptPlan, requestPlan, tools: [] }).enabled).toBe(false);
});
