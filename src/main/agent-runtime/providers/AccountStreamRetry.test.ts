import { describe, expect, it, vi } from 'vitest';
import { EventStream } from '../core/EventStream';
import type { AssistantMessage, AssistantMessageEvent } from '../core/types';
import { ProviderHttpError } from './internal/http';
import { streamWithUnauthorizedRefresh } from './AccountStreamRetry';

const message: AssistantMessage = {
  role: 'assistant',
  content: [],
  provider: 'provider-a',
  model: 'model-a',
  usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  stopReason: 'stop',
  timestamp: 0,
};

function attempt(events: AssistantMessageEvent[], error?: Error): EventStream<AssistantMessageEvent, AssistantMessage> {
  const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
    (event) => event.type === 'done',
    (event) => (event as Extract<AssistantMessageEvent, { type: 'done' }>).message,
  );
  queueMicrotask(() => {
    for (const event of events) stream.push(event);
    if (error) stream.error(error);
  });
  return stream;
}

describe('account stream 401 retry', () => {
  it('refreshes and retries once before any stream content', async () => {
    const unauthorized = new ProviderHttpError('test', 401, 'expired');
    const attempts = [
      () => attempt([
        { type: 'start', partial: message },
        { type: 'error', error: unauthorized, message },
      ], unauthorized),
      () => attempt([
        { type: 'start', partial: message },
        { type: 'text_delta', contentIndex: 0, delta: 'ok', partial: message },
        { type: 'done', reason: 'stop', message },
      ]),
    ];
    const refresh = vi.fn(async () => undefined);
    const stream = streamWithUnauthorizedRefresh({ createAttempt: () => attempts.shift()!(), refresh });
    const types: string[] = [];
    for await (const event of stream) types.push(event.type);
    expect(types).toEqual(['start', 'text_delta', 'done']);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('never replays after stream content was emitted', async () => {
    const unauthorized = new ProviderHttpError('test', 401, 'late rejection');
    const refresh = vi.fn(async () => undefined);
    const stream = streamWithUnauthorizedRefresh({
      createAttempt: () => attempt([
        { type: 'start', partial: message },
        { type: 'text_delta', contentIndex: 0, delta: 'partial', partial: message },
        { type: 'error', error: unauthorized, message },
      ], unauthorized),
      refresh,
    });
    await expect((async () => {
      for await (const _event of stream) { /* consume */ }
    })()).rejects.toBe(unauthorized);
    expect(refresh).not.toHaveBeenCalled();
  });
});
