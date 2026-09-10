import { expect, it, vi } from 'vitest';
import { connectBrowserEventStream } from './browserEventStream';
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
it('does not deliver a queued read after stream ownership is aborted', async () => {
 let controller!: ReadableStreamDefaultController<Uint8Array>;
 const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
 const received = vi.fn();
 const disconnect = connectBrowserEventStream('http://localhost/events', received, vi.fn(async () => new Response(body)) as typeof fetch);
 await tick(); disconnect();
 try { controller.enqueue(new TextEncoder().encode('data: {"channel":"conversation:event","args":["late"]}\n\n')); } catch { /* cancellation may already have closed the stream */ }
 await tick(); expect(received).not.toHaveBeenCalled();
});
it('reconnects the event stream after EOF and cancels any further reconnect after unsubscribe', async () => {
 vi.useFakeTimers();
 const fetcher = vi.fn(async () => new Response(new ReadableStream({start(controller) { controller.close(); }})));
 const disconnect = connectBrowserEventStream('http://localhost/events', vi.fn(), fetcher as typeof fetch);
 try {
  await vi.advanceTimersByTimeAsync(0); expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(250); expect(fetcher).toHaveBeenCalledTimes(2);
  disconnect(); await vi.advanceTimersByTimeAsync(10000); expect(fetcher).toHaveBeenCalledTimes(2);
 } finally { disconnect(); vi.useRealTimers(); }
});
