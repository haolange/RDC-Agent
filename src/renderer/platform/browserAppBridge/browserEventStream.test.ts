import { describe, expect, it, vi } from 'vitest';
import { connectBrowserEventStream, createEventStreamParser } from './browserEventStream';

describe('browser event stream', () => {
  it('parses split CRLF and multiline frames while isolating malformed JSON', () => {
    const parser = createEventStreamParser();
    expect(
      parser.push('data: {"channel":"conversation:event","args":[1]}\r\n\r\ndata: {bad}\n\ndata: {"channel":'),
    ).toEqual([{ channel: 'conversation:event', args: [1] }]);
    expect(parser.push('"app:event",\ndata: "args":[]}\r')).toEqual([]);
    expect(parser.push('\n\r\n')).toEqual([{ channel: 'app:event', args: [] }]);
  });

  it('finds a boundary split across chunks and keeps a large frame linear', () => {
    const parser = createEventStreamParser();
    const payload = JSON.stringify({ channel: 'conversation:event', args: ['x'.repeat(200_000)] });
    const frame = `data: ${payload}\n\n`;
    const events = [];
    for (let offset = 0; offset < frame.length; offset += 1_000)
      events.push(...parser.push(frame.slice(offset, offset + 1_000)));
    expect(events).toHaveLength(1);
    expect(parser.push('data: {"channel":"app:event"}\n')).toEqual([]);
    expect(parser.push('\n')).toEqual([{ channel: 'app:event' }]);
  });

  it('uses authenticated POST, dispatches stream frames, and aborts ownership', async () => {
    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(body, { status: 200 }),
    );
    const received: unknown[] = [];
    const disconnect = connectBrowserEventStream(
      'http://127.0.0.1/events',
      (event) => received.push(event),
      fetchImpl as typeof fetch,
    );
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    const init = fetchImpl.mock.calls[0]![1]!;
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
    streamController!.enqueue(encoder.encode('data: {"channel":"conversation:event","args":["done"]}\n\n'));
    await vi.waitFor(() => expect(received).toEqual([{ channel: 'conversation:event', args: ['done'] }]));
    disconnect();
    expect((init.signal as AbortSignal).aborted).toBe(true);
  });

  it('does not reconnect after an authorization rejection', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('', { status: 401 }),
    );
    connectBrowserEventStream('http://127.0.0.1/events', vi.fn(), fetchImpl as typeof fetch);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    await new Promise((resolve) => globalThis.setTimeout(resolve, 300));
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('does not dispatch a queued frame after disconnect', async () => {
    const encoder = new TextEncoder();
    let resolveRead: ((value: ReadableStreamReadResult<Uint8Array>) => void) | undefined;
    const reader = {
      read: vi.fn(
        () =>
          new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
            resolveRead = resolve;
          }),
      ),
      cancel: vi.fn(async () => undefined),
      releaseLock: vi.fn(),
    };
    const response = { ok: true, status: 200, body: { getReader: () => reader } } as unknown as Response;
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response);
    const received = vi.fn();
    const disconnect = connectBrowserEventStream('http://127.0.0.1/events', received, fetchImpl as typeof fetch);
    await vi.waitFor(() => expect(reader.read).toHaveBeenCalledOnce());
    disconnect();
    resolveRead!({ done: false, value: encoder.encode('data: {"channel":"conversation:event"}\n\n') });
    await vi.waitFor(() => expect(reader.cancel).toHaveBeenCalledOnce());
    expect(received).not.toHaveBeenCalled();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
  });

  it('stops dispatching the remaining frames when a listener disconnects ownership', async () => {
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(body));
    const received: string[] = [];
    let disconnect = () => {};
    disconnect = connectBrowserEventStream(
      'http://127.0.0.1/events',
      (event) => {
        received.push(event.channel);
        disconnect();
      },
      fetchImpl as typeof fetch,
    );
    streamController.enqueue(
      encoder.encode(['data: {"channel":"first"}', '', 'data: {"channel":"late"}', '', ''].join('\n')),
    );
    await vi.waitFor(() => expect(received).toEqual(['first']));
  });
});
