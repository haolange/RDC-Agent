import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_MCP_BUFFER_BYTES, parseJsonRpcResponse } from './mcpRpcTransport';
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

  it('rejects oversized outbound JSON-RPC requests for stdio payload serialization', async () => {
    await expect(new MCPManager().connect({
      name: 'oversized-stdio-payload',
      type: 'http',
      url: 'http://127.0.0.1:1',
    })).rejects.toThrow();
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

  it('fail-closes unsupported MCP transports including legacy sse', async () => {
    await expect(new MCPManager().connect({
      name: 'legacy-sse',
      type: 'sse' as 'http',
      url: 'http://127.0.0.1:1',
    })).rejects.toThrow(/MCP_TRANSPORT_UNSUPPORTED/);
  });
});