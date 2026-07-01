import { describe, expect, it, vi } from 'vitest';
import {
  composeAbortSignals,
  parseSSE,
  ProviderTimeoutError,
} from './http';

describe('provider http stream helpers', () => {
  it('classifies first-byte timeout before any stream chunk arrives', async () => {
    vi.useFakeTimers();
    const response = new Response(new ReadableStream<Uint8Array>());
    const iterator = parseSSE(response, undefined, {
      providerApi: 'test-provider',
      firstChunkTimeoutMs: 20,
      streamIdleTimeoutMs: 100,
    });

    const pending = iterator.next();
    vi.advanceTimersByTime(20);

    await expect(pending).rejects.toMatchObject({
      name: 'ProviderTimeoutError',
      phase: 'first-byte',
      timeoutMs: 20,
      providerApi: 'test-provider',
    });
    vi.useRealTimers();
  });

  it('classifies idle timeout after the stream has started', async () => {
    vi.useRealTimers();
    const encoder = new TextEncoder();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: first\n\n'));
      },
    }));
    const iterator = parseSSE(response, undefined, {
      providerApi: 'test-provider',
      firstChunkTimeoutMs: 20,
      streamIdleTimeoutMs: 5,
    });

    await expect(iterator.next()).resolves.toEqual({ value: 'first', done: false });

    const pending = iterator.next();

    await expect(pending).rejects.toMatchObject({
      name: 'ProviderTimeoutError',
      phase: 'idle',
      timeoutMs: 5,
      providerApi: 'test-provider',
    });
  });

  it('aborts the composed signal with a total request timeout reason', () => {
    vi.useFakeTimers();
    const internal = new AbortController();
    const composed = composeAbortSignals(undefined, internal.signal, {
      providerApi: 'test-provider',
      requestTimeoutMs: 50,
    });

    vi.advanceTimersByTime(50);

    expect(composed.signal.aborted).toBe(true);
    expect(composed.signal.reason).toBeInstanceOf(ProviderTimeoutError);
    expect((composed.signal.reason as ProviderTimeoutError).phase).toBe('total');
    composed.dispose();
    vi.useRealTimers();
  });
});
