import { describe, expect, it, vi } from 'vitest';
import {
  composeAbortSignals,
  ensureOk,
  parseSSE,
  parseSSERecords,
  ProviderEmptyStreamError,
  ProviderHttpError,
  ProviderTimeoutError,
  registerStreamActivity,
} from './http';

describe('provider http stream helpers', () => {
  it('distinguishes empty-stream from a real HTTP 502', () => {
    const empty = new ProviderEmptyStreamError('openai-responses');
    const http = new ProviderHttpError('openai-responses', 502, 'Bad Gateway');
    expect(empty).toBeInstanceOf(ProviderEmptyStreamError);
    expect(empty).not.toBeInstanceOf(ProviderHttpError);
    expect(empty.code).toBe('PROVIDER_STREAM_EMPTY');
    expect(http.status).toBe(502);
    expect(empty).not.toHaveProperty('status');
  });

  it('summarizes an HTML gateway error without leaking markup into product diagnostics', async () => {
    const response = new Response(
      '<!DOCTYPE html><html><head><title>opencode.ai | 502: Bad gateway</title></head><body>proxy</body></html>',
      {
        status: 502,
        headers: { 'Content-Type': 'text/html' },
      },
    );

    await expect(ensureOk(response, 'openai-compatible')).rejects.toMatchObject({
      message: 'PROVIDER_HTTP_ERROR: [openai-compatible] HTTP 502: opencode.ai | 502: Bad gateway',
      status: 502,
    });
  });

  it('reads a stream without any timer of its own: the stream watchdog owns every deadline', async () => {
    vi.useFakeTimers();
    const response = new Response(new ReadableStream<Uint8Array>());
    const pending = parseSSE(response, undefined, { providerApi: 'test-provider' }).next();
    const settled = vi.fn();
    void pending.then(settled, settled);

    await vi.advanceTimersByTimeAsync(3_600_000);

    expect(settled).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('reports every received chunk to the watchdog registered for the signal', async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: a\n\n'));
          controller.enqueue(encoder.encode('data: b\n\n'));
          controller.close();
        },
      }),
    );
    const signal = new AbortController().signal;
    const touch = vi.fn();
    registerStreamActivity(signal, touch);

    const out: string[] = [];
    for await (const data of parseSSE(response, signal, { providerApi: 'test-provider' })) out.push(data);

    expect(out).toEqual(['a', 'b']);
    expect(touch.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects a pending read with the abort reason, so a watchdog timeout surfaces as the timeout', async () => {
    const controller = new AbortController();
    const response = new Response(new ReadableStream<Uint8Array>());
    const pending = parseSSE(response, controller.signal, { providerApi: 'test-provider' }).next();

    const timeout = new ProviderTimeoutError('test-provider', 'first-byte', 20);
    controller.abort(timeout);

    await expect(pending).rejects.toBe(timeout);
  });

  it('aborts the composed signal with the reason given to abort and stops following the sources after dispose', () => {
    const internal = new AbortController();
    const composed = composeAbortSignals(undefined, internal.signal);
    const timeout = new ProviderTimeoutError('test-provider', 'idle', 5, true);

    composed.abort(timeout);
    composed.abort(new Error('ignored: already aborted'));

    expect(composed.signal.reason).toBe(timeout);
    expect(timeout.afterContent).toBe(true);
    composed.dispose();
  });

  it('keeps the SSE event name with its data record', async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('event: contentBlockDelta\ndata: {"ok":true}\n\n'));
          controller.close();
        },
      }),
    );
    const records = [];
    for await (const record of parseSSERecords(response, undefined, { providerApi: 'test-provider' }))
      records.push(record);
    expect(records).toEqual([{ event: 'contentBlockDelta', data: '{"ok":true}' }]);
  });
});
