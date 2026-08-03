import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_MCP_BUFFER_BYTES, MAX_SSE_EVENT_BYTES, SseRpcClient, parseJsonRpcResponse } from './mcpRpcTransport';
import { MCPManager } from './MCPManager';

describe('MCP RPC transport bounds', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses only valid JSON-RPC envelopes', () => {
    expect(parseJsonRpcResponse('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}')).toMatchObject({ id: 1 });
    expect(parseJsonRpcResponse('not-json')).toBeNull();
    expect(parseJsonRpcResponse('{"jsonrpc":"1.0","id":1}')).toBeNull();
  });

  it('rejects oversized HTTP responses before JSON parsing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('x'.repeat(MAX_MCP_BUFFER_BYTES + 1), { status: 200 }),
    ));
    await expect(new SseRpcClient('http://127.0.0.1:1').request('tools/call', {}, 1000))
      .rejects.toThrow(/exceeded/);
  });

  it('rejects oversized outbound JSON-RPC requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(new SseRpcClient('http://127.0.0.1:1').request(
      'tools/call',
      { payload: 'x'.repeat(MAX_MCP_BUFFER_BYTES + 1) },
      1000,
    )).rejects.toThrow(/exceeded/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds cumulative streamable HTTP responses before parsing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('x'.repeat(MAX_MCP_BUFFER_BYTES + 1), { status: 200 }),
    ));
    await expect(new MCPManager().connect({
      name: 'oversized-streamable-http',
      type: 'streamable-http',
      url: 'http://127.0.0.1:1',
    })).rejects.toThrow(/exceeded/);
  });

  it('flushes a final SSE event at EOF and rejects pending calls on connection close', async () => {
    let enqueue!: (chunk: string) => void;
    let closeStream!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        enqueue = (chunk) => controller.enqueue(new TextEncoder().encode(chunk));
        closeStream = () => controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));
    const client = new SseRpcClient('http://127.0.0.1:1');
    const pending = new Promise<unknown>((resolve, reject) => {
      (client as unknown as {
        pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>;
      }).pending.set(1, { resolve, reject });
    });
    await client.connect(1000);
    enqueue('data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}');
    closeStream();
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it('bounds each SSE event independently and keeps the stream reader cancellable', async () => {
    let enqueue!: (chunk: string) => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        enqueue = (chunk) => controller.enqueue(new TextEncoder().encode(chunk));
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SseRpcClient('http://127.0.0.1:1');
    await client.connect(1000);
    enqueue(`data: ${'x'.repeat(MAX_SSE_EVENT_BYTES)}\n\n`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(client.request('tools/call', {}, 1000)).rejects.toThrow(/closed/);
    client.close();
  });

  it('separates header timeout from the long-lived stream lifetime', async () => {
    let cancelCount = 0;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelCount += 1;
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SseRpcClient('http://127.0.0.1:1');
    await client.connect(1000);
    const headerSignal = fetchMock.mock.calls[0]?.[1]?.signal as AbortSignal;
    expect(headerSignal.aborted).toBe(false);
    client.close();
    expect(headerSignal.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancelCount).toBe(1);
  });

  it('bounds MCPManager HTTP responses before parsing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('x'.repeat(MAX_MCP_BUFFER_BYTES + 1), { status: 200 }),
    ));
    await expect(new MCPManager().connect({
      name: 'oversized-http',
      type: 'http',
      url: 'http://127.0.0.1:1',
    })).rejects.toThrow(/exceeded/);
  });
});
