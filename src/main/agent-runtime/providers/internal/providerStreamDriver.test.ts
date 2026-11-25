import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createTestRequestPlan } from '../../../testing/createTestRequestPlan';
import { createProviderOutputRef } from './AssistantStreamBuilder';
import { ProviderHttpError, ProviderTimeoutError } from './http';
import {
  httpStreamFailure,
  readProviderFrames,
  sendProviderRequest,
  startProviderStream,
  type ProviderFrameStream,
} from './providerStreamDriver';
import type { AssistantMessageEvent, Model, StreamOptions } from '../../core/types';

const requestPlan = createTestRequestPlan({
  providerId: 'fixture',
  adapterId: 'openai-compatible',
  catalogRevision: 'fixture',
  routeRevision: 'fixture',
  selectedModelId: 'm',
  effectiveModelId: 'm',
  appliedBindingIds: [],
  route: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://provider.fixture', source: 'catalog' },
  headers: {},
  bodyPatch: {},
  contextBudgetTokens: 128_000,
  contextMode: 'normal',
  contextWindowTokens: 128_000,
  activeTierId: 'default',
  fastMode: false,
  reasoningWire: { selection: 'unknown', control: { kind: 'none' } },
} as never);
const model = { id: 'm', name: 'm', provider: 'fixture', api: 'fixture', contextWindow: 128_000, maxTokens: 1024 } as Model;
const options: StreamOptions = { requestPlan, firstChunkTimeoutMs: 2_000, streamIdleTimeoutMs: 2_000 };
const textRef = createProviderOutputRef({ protocol: 'fixture', providerBlockKey: 'text:0', contentIndex: 0 });

const FrameSchema = z.object({ text: z.string() });
const sseFrames: ProviderFrameStream<z.infer<typeof FrameSchema>> = { providerApi: 'fixture', framing: 'sse', frameSchema: FrameSchema };
const lineFrames: ProviderFrameStream<z.infer<typeof FrameSchema>> = { ...sseFrames, framing: 'json-lines' };

async function collect<T>(frames: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const frame of frames) out.push(frame);
  return out;
}

async function errorEvent(stream: AsyncIterable<AssistantMessageEvent>): Promise<Extract<AssistantMessageEvent, { type: 'error' }> | undefined> {
  let failure: Extract<AssistantMessageEvent, { type: 'error' }> | undefined;
  try {
    for await (const event of stream) if (event.type === 'error') failure = event;
  } catch {
    // The stream rejects after its error event.
  }
  return failure;
}

describe('startProviderStream', () => {
  it('finishes the message after the run returns, once the wire sent its terminal signal', async () => {
    const stream = startProviderStream({ providerApi: 'fixture', model, options }, async ({ builder }) => {
      builder.startText(textRef);
      builder.appendText(textRef, 'Hello');
      builder.markTerminal('stop');
      return { sawOutput: true };
    });

    const message = await stream.result();
    expect(message).toMatchObject({ stopReason: 'stop', content: [{ type: 'text', text: 'Hello' }] });
  });

  it('fails a message whose output ended without the terminal signal', async () => {
    const stream = startProviderStream({ providerApi: 'fixture', model, options }, async ({ builder }) => {
      builder.startText(textRef);
      builder.appendText(textRef, 'Hello wor');
      return { sawOutput: true };
    });

    await expect(stream.result()).rejects.toMatchObject({ code: 'PROVIDER_STREAM_TRUNCATED' });
  });

  it('ends a failed run through the adapter failure mapping when one is given', async () => {
    const mapped = new Error('mapped by the adapter');
    const failure = vi.fn((_thrown: unknown, _signal: AbortSignal) => ({ error: mapped, reason: 'aborted' as const }));
    const thrown = new Error('closed by the sdk');
    const stream = startProviderStream({ providerApi: 'fixture', model, options, failure }, async () => {
      throw thrown;
    });

    const event = await errorEvent(stream);
    expect(failure).toHaveBeenCalledWith(thrown, expect.any(AbortSignal));
    expect(event).toMatchObject({ error: mapped, message: { stopReason: 'aborted' } });
  });
});

describe('httpStreamFailure', () => {
  it('reports an abort with the reason the signal fired, so a timeout stays a timeout', () => {
    const controller = new AbortController();
    const timeout = new ProviderTimeoutError('fixture', 'total', 10);
    controller.abort(timeout);

    expect(httpStreamFailure(new DOMException('aborted', 'AbortError'), controller.signal)).toEqual({ error: timeout, reason: 'error' });
  });

  it('reports a user abort as aborted and any other error as thrown', () => {
    const controller = new AbortController();
    const httpError = new ProviderHttpError('fixture', 500, 'boom');
    expect(httpStreamFailure(httpError, controller.signal)).toEqual({ error: httpError, reason: 'error' });

    controller.abort();
    expect(httpStreamFailure(new DOMException('aborted', 'AbortError'), controller.signal).reason).toBe('aborted');
  });
});

describe('sendProviderRequest', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('signs the exact body text it sends and returns an OK response', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const authorizer = vi.fn(async (input: { headers: Record<string, string> }) => ({ ...input.headers, authorization: 'signed' }));
    const signal = new AbortController().signal;

    const response = await sendProviderRequest('fixture', requestPlan, signal, {
      url: 'https://provider.fixture/chat',
      headers: { 'Content-Type': 'application/json' },
      body: { model: 'm', stream: true },
      authorizer,
    });

    expect(response.status).toBe(200);
    expect(authorizer).toHaveBeenCalledWith({
      url: 'https://provider.fixture/chat',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"model":"m","stream":true}',
    });
    expect(fetchMock).toHaveBeenCalledWith('https://provider.fixture/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'signed' },
      body: '{"model":"m","stream":true}',
      signal,
    });
  });

  it('turns a failed status into a provider HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream down', { status: 503 })));

    await expect(sendProviderRequest('fixture', requestPlan, new AbortController().signal, {
      url: 'https://provider.fixture/chat',
      headers: {},
      body: {},
    })).rejects.toMatchObject({ name: 'ProviderHttpError', status: 503 });
  });
});

describe('readProviderFrames', () => {
  it('parses JSON lines and SSE frames, handing the Chat Completions sentinel to its callback', async () => {
    const onDoneSentinel = vi.fn();
    const signal = new AbortController().signal;
    const lines = new Response('{"text":"a"}\n{"text":"b"}\n');
    const events = new Response('data: {"text":"a"}\n\ndata: [DONE]\n\ndata: {"text":"after"}\n\n');

    expect(await collect(readProviderFrames(lines, signal, options, lineFrames))).toEqual([{ text: 'a' }, { text: 'b' }]);
    expect(await collect(readProviderFrames(events, signal, options, sseFrames, onDoneSentinel))).toEqual([{ text: 'a' }]);
    expect(onDoneSentinel).toHaveBeenCalledOnce();
  });

  it('fails on a frame of another shape instead of skipping it', async () => {
    const frames = readProviderFrames(new Response('data: {"text":1}\n\n'), new AbortController().signal, options, sseFrames);

    await expect(collect(frames)).rejects.toMatchObject({ code: 'PROVIDER_STREAM_MALFORMED_FRAME' });
  });

  it('stops yielding once the signal aborted and leaves reporting the abort to the driver', async () => {
    const controller = new AbortController();
    const frames = readProviderFrames(new Response('{"text":"a"}\n{"text":"b"}\n'), controller.signal, options, lineFrames);
    const seen: string[] = [];
    for await (const frame of frames) {
      seen.push(frame.text);
      controller.abort();
    }

    expect(seen).toEqual(['a']);
  });
});
