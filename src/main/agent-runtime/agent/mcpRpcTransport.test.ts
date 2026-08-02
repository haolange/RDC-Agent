import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_MCP_BUFFER_BYTES, SseRpcClient, parseJsonRpcResponse } from './mcpRpcTransport';
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
