import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';

import { AiSdkStreamingProvider } from './AiSdkStreamingProvider';
import { ProviderTimeoutError } from './internal/http';
import type { LanguageModel } from 'ai';

const streamTextMock = vi.hoisted(() => vi.fn());
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return { ...actual, streamText: streamTextMock };
});

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
    control: {
      kind: 'unknown',
      supportsOff: false,
      levels: [],
      defaultSelection: 'off',
      wireProfile: { kind: 'none' },
    },
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
          type: 'finish',
          finishReason: 'tool-calls',
          rawFinishReason: 'tool_use',
          totalUsage: {
            inputTokens: 12,
            outputTokens: 8,
            totalTokens: 20,
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
    const stream = provider.stream(
      {
        id: 'duo-chat-opus-4-8',
        name: 'Opus',
        provider: 'gitlab',
        api: 'gitlab-duo',
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        reasoning: true,
        vision: true,
      },
      {
        systemPrompt: 'system',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'open' },
              { type: 'image', data: 'AA==', mimeType: 'image/png' },
            ],
            timestamp: 1,
          },
          {
            role: 'toolResult',
            toolCallId: 'old-call',
            toolName: 'read',
            content: [{ type: 'text', text: 'done' }],
            isError: false,
            timestamp: 2,
          },
        ],
        tools: [
          {
            name: 'inspect',
            description: 'Inspect a capture',
            parameters: { type: 'object', properties: { path: { type: 'string' } } },
          },
        ],
      },
      { requestPlan },
    );

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
      expect.objectContaining({
        type: 'text',
        text: 'hello',
        providerOutputRef: expect.objectContaining({ providerBlockKey: 'part:text-1' }),
      }),
      expect.objectContaining({ type: 'thinking', text: 'think', kind: 'unknown' }),
      expect.objectContaining({
        type: 'toolCall',
        id: 'call-1',
        name: 'inspect',
        arguments: { path: 'a.rdc' },
        providerOutputRef: expect.objectContaining({ providerBlockKey: 'part:call-1' }),
      }),
    ]);
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'system',
        maxRetries: 0,
        messages: [
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([expect.objectContaining({ type: 'image', mediaType: 'image/png' })]),
          }),
          expect.objectContaining({ role: 'tool' }),
        ],
        tools: expect.objectContaining({ inspect: expect.any(Object) }),
      }),
    );
  });

  it('fails closed before provider creation when the frozen effective model differs', async () => {
    streamTextMock.mockClear();
    const createModel = vi.fn(async () => ({}) as Exclude<LanguageModel, string>);
    const provider = new AiSdkStreamingProvider({ api: 'gitlab-duo', createModel });
    const stream = provider.stream(
      {
        id: 'duo-chat-opus-4-8',
        name: 'Opus',
        provider: 'gitlab',
        api: 'gitlab-duo',
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        reasoning: true,
        vision: true,
      },
      { messages: [] },
      {
        requestPlan: { ...requestPlan, effectiveModelId: 'duo-chat-sonnet-5' },
      },
    );

    await expect(stream.result()).rejects.toThrow(
      'RequestPlan model duo-chat-sonnet-5 does not match duo-chat-opus-4-8.',
    );
    expect(createModel).not.toHaveBeenCalled();
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  describe('watchdog', () => {
    afterEach(() => vi.useRealTimers());
    const model = {
      id: 'duo-chat-opus-4-8',
      name: 'Opus',
      provider: 'gitlab',
      api: 'gitlab-duo',
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      reasoning: true,
      vision: true,
    };
    const provider = () =>
      new AiSdkStreamingProvider({
        api: 'gitlab-duo',
        createModel: async () => ({}) as Exclude<LanguageModel, string>,
      });
    /** A fullStream that sends `parts`, then stays silent until the request is aborted, as the SDK does. */
    function silentAfter(parts: Array<{ type: string } & Record<string, unknown>>, gapMs = 0) {
      streamTextMock.mockImplementation((input: { abortSignal: AbortSignal }) => ({
        fullStream: (async function* () {
          for (const part of parts) {
            yield part;
            if (gapMs) await new Promise((resolve) => setTimeout(resolve, gapMs));
          }
          await new Promise<void>((resolve) => input.abortSignal.addEventListener('abort', () => resolve()));
          yield { type: 'abort' };
        })(),
      }));
    }
    const capture = async (stream: AsyncIterable<{ type: string }>) => {
      try {
        for await (const event of stream)
          if (event.type === 'error') return event as never as { error: Error; message: { stopReason: string } };
      } catch {
        // rejects after its error event
      }
      return undefined;
    };

    it('reports a first-byte timeout as the timeout, not as an abort', async () => {
      vi.useFakeTimers();
      silentAfter([]);
      const stream = provider().stream(model, { messages: [] }, { requestPlan, firstChunkTimeoutMs: 100 });
      const failed = capture(stream);

      await vi.advanceTimersByTimeAsync(100);

      const event = await failed;
      expect(event?.error).toBeInstanceOf(ProviderTimeoutError);
      expect(event?.error).toMatchObject({ phase: 'first-byte', afterContent: false });
      expect(event?.message.stopReason).toBe('error');
    });

    it('touches the watchdog on each part and reports an idle timeout after content', async () => {
      vi.useFakeTimers();
      silentAfter(
        [
          { type: 'start' },
          { type: 'text-start', id: 't' },
          { type: 'text-delta', id: 't', text: 'a' },
          { type: 'text-delta', id: 't', text: 'b' },
        ],
        60,
      );
      const stream = provider().stream(
        model,
        { messages: [] },
        { requestPlan, firstChunkTimeoutMs: 100, streamIdleTimeoutMs: 80 },
      );
      const failed = capture(stream);

      await vi.advanceTimersByTimeAsync(60 * 4);
      await vi.advanceTimersByTimeAsync(80);

      const event = await failed;
      expect(event?.error).toMatchObject({
        name: 'ProviderTimeoutError',
        phase: 'idle',
        timeoutMs: 80,
        afterContent: true,
      });
    });

    it('does not count the SDK start part as the provider answering', async () => {
      vi.useFakeTimers();
      silentAfter([{ type: 'start' }]);
      const stream = provider().stream(model, { messages: [] }, { requestPlan, firstChunkTimeoutMs: 100 });
      const failed = capture(stream);

      await vi.advanceTimersByTimeAsync(100);

      expect((await failed)?.error).toMatchObject({ phase: 'first-byte' });
    });

    it('still reports a user abort as aborted', async () => {
      silentAfter([]);
      const controller = new AbortController();
      const stream = provider().stream(model, { messages: [] }, { requestPlan, signal: controller.signal });
      const failed = capture(stream);
      await new Promise((resolve) => setTimeout(resolve, 5));

      controller.abort();

      const event = await failed;
      expect(event?.error).not.toBeInstanceOf(ProviderTimeoutError);
      expect(event?.message.stopReason).toBe('aborted');
    });
  });
});
