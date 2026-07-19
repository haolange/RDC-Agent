import { describe, expect, it, vi } from 'vitest';
import type { LanguageModel } from 'ai';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';

const streamTextMock = vi.hoisted(() => vi.fn());

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return { ...actual, streamText: streamTextMock };
});

import { AiSdkStreamingProvider } from './AiSdkStreamingProvider';

const requestPlan = createTestRequestPlan({
  providerId: 'gitlab',
  adapterId: 'gitlab-duo',
  catalogRevision: 'catalog-1',
  routeRevision: 'route-1',
  selectedModelId: 'duo-chat-opus-4-8',
  effectiveModelId: 'duo-chat-opus-4-8',
  appliedBindingIds: [],
  route: { protocol: 'GitLabDuo', baseUrl: 'https://gitlab.com', source: 'catalog' },
  headers: {},
  bodyPatch: {},
  contextBudgetTokens: 256_000,
  contextMode: 'normal',
  contextWindowTokens: 1_000_000,
  activeTierId: 'default',
  fastMode: false,
  reasoningWire: {
    selection: 'off',
    control: { kind: 'unknown', supportsOff: false, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
  },
});

describe('AiSdkStreamingProvider', () => {
  it('maps the shared prompt and normalizes text, reasoning, tool calls, and usage', async () => {
    streamTextMock.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'text-start', id: 'text-1' };
        yield { type: 'text-delta', id: 'text-1', text: 'hello' };
        yield { type: 'text-end', id: 'text-1' };
        yield { type: 'reasoning-start', id: 'reasoning-1' };
        yield { type: 'reasoning-delta', id: 'reasoning-1', text: 'think' };
        yield { type: 'reasoning-end', id: 'reasoning-1' };
        yield { type: 'tool-input-start', id: 'call-1', toolName: 'inspect' };
        yield { type: 'tool-input-delta', id: 'call-1', delta: '{"path":"a.rdc"}' };
        yield { type: 'tool-input-end', id: 'call-1' };
        yield { type: 'tool-call', toolCallId: 'call-1', toolName: 'inspect', input: { path: 'a.rdc' } };
        yield {
          type: 'finish', finishReason: 'tool-calls', rawFinishReason: 'tool_use',
          totalUsage: {
            inputTokens: 12, outputTokens: 8, totalTokens: 20,
            inputTokenDetails: { noCacheTokens: 10, cacheReadTokens: 2, cacheWriteTokens: 0 },
            outputTokenDetails: { textTokens: 6, reasoningTokens: 2 },
          },
        };
      })(),
    });
    const provider = new AiSdkStreamingProvider({
      api: 'gitlab-duo',
      createModel: async () => ({}) as Exclude<LanguageModel, string>,
    });
    const stream = provider.stream({
      id: 'duo-chat-opus-4-8', name: 'Opus', provider: 'gitlab', api: 'gitlab-duo',
      contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, vision: true,
    }, {
      systemPrompt: 'system',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'open' }, { type: 'image', data: 'AA==', mimeType: 'image/png' }], timestamp: 1 },
        { role: 'toolResult', toolCallId: 'old-call', toolName: 'read', content: [{ type: 'text', text: 'done' }], isError: false, timestamp: 2 },
      ],
      tools: [{ name: 'inspect', description: 'Inspect a capture', parameters: { type: 'object', properties: { path: { type: 'string' } } } }],
    }, { requestPlan });

    const message = await stream.result();
    expect(message.stopReason).toBe('toolUse');
    expect(message.usage).toMatchObject({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      reasoningTokens: 2,
      cacheReadTokens: 2,
      cacheHitTokens: 2,
      cacheMissTokens: 10,
    });
    expect(message.content).toEqual([
      expect.objectContaining({ type: 'text', text: 'hello', providerOutputRef: expect.objectContaining({ providerBlockKey: 'part:text-1' }) }),
      expect.objectContaining({ type: 'thinking', text: 'think', kind: 'unknown' }),
      expect.objectContaining({ type: 'toolCall', id: 'call-1', name: 'inspect', arguments: { path: 'a.rdc' }, providerOutputRef: expect.objectContaining({ providerBlockKey: 'part:call-1' }) }),
    ]);
    expect(streamTextMock).toHaveBeenCalledWith(expect.objectContaining({
      system: 'system',
      maxRetries: 0,
      messages: [
        expect.objectContaining({ role: 'user', content: expect.arrayContaining([expect.objectContaining({ type: 'image', mediaType: 'image/png' })]) }),
        expect.objectContaining({ role: 'tool' }),
      ],
      tools: expect.objectContaining({ inspect: expect.any(Object) }),
    }));
  });

  it('fails closed before provider creation when the frozen effective model differs', async () => {
    streamTextMock.mockClear();
    const createModel = vi.fn(async () => ({}) as Exclude<LanguageModel, string>);
    const provider = new AiSdkStreamingProvider({ api: 'gitlab-duo', createModel });
    const stream = provider.stream({
      id: 'duo-chat-opus-4-8', name: 'Opus', provider: 'gitlab', api: 'gitlab-duo',
      contextWindow: 1_000_000, maxTokens: 128_000, reasoning: true, vision: true,
    }, { messages: [] }, {
      requestPlan: { ...requestPlan, effectiveModelId: 'duo-chat-sonnet-5' },
    });

    await expect(stream.result()).rejects.toThrow(
      'RequestPlan model duo-chat-sonnet-5 does not match duo-chat-opus-4-8.',
    );
    expect(createModel).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
  });
});
