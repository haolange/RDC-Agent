/**
 * MCPManager 单元测试。
 * 测试核心逻辑：工具名称前缀、解析、工具注册/发现。
 */
import { createServer } from 'node:http';
import { describe, it, expect, beforeEach } from 'vitest';
import { toolValidator } from '../core/ToolValidator';
import { MCPManager } from './MCPManager';
import { buildMcpPrefixedName, decodeMcpNameSegment, encodeMcpNameSegment } from './mcpToolNames';
import type { AddressInfo } from 'node:net';

describe('MCPManager', () => {
  let manager: MCPManager;

  beforeEach(() => {
    manager = new MCPManager();
  });

  describe('工具名称解析', () => {
    it('isMCPTool 应识别 mcp__ 前缀', () => {
      expect(manager.isMCPTool('mcp__server__tool')).toBe(true);
      expect(manager.isMCPTool('shell')).toBe(false);
      expect(manager.isMCPTool('read_file')).toBe(false);
      expect(manager.isMCPTool('')).toBe(false);
    });

    it('parsePrefixedName 应正确解析可逆编码名', () => {
      const prefixed = buildMcpPrefixedName('filesystem', 'read');
      const result = manager.parsePrefixedName(prefixed);
      expect(result).not.toBeNull();
      expect(result!.serverName).toBe('filesystem');
      expect(result!.toolName).toBe('read');
    });

    it('parsePrefixedName 对无效名称返回 null', () => {
      expect(manager.parsePrefixedName('shell')).toBeNull();
      expect(manager.parsePrefixedName('mcp__')).toBeNull();
      expect(manager.parsePrefixedName('mcp____')).toBeNull();
      expect(manager.parsePrefixedName('')).toBeNull();
    });

    it('parsePrefixedName 对非 roundtrip 片段返回 null', () => {
      expect(manager.parsePrefixedName('mcp__filesystem__read')).toBeNull();
      expect(manager.parsePrefixedName('mcp__my_server__my_tool')).toBeNull();
      expect(decodeMcpNameSegment('filesystem')).toBeNull();
      expect(decodeMcpNameSegment('not-a-valid-encoding')).toBeNull();
    });

    it('encode/decode 对合法片段可逆', () => {
      const samples = ['filesystem', 'read_file', 'my-server', 'tool with space', '中文'];
      for (const sample of samples) {
        const encoded = encodeMcpNameSegment(sample);
        expect(decodeMcpNameSegment(encoded)).toBe(sample);
        expect(encodeMcpNameSegment(decodeMcpNameSegment(encoded) ?? '')).toBe(encoded);
      }
    });

    it('parsePrefixedName 应处理带特殊字符的服务器名', () => {
      const prefixed = buildMcpPrefixedName('my_server', 'my_tool');
      const result = manager.parsePrefixedName(prefixed);
      expect(result).not.toBeNull();
      expect(result!.serverName).toBe('my_server');
      expect(result!.toolName).toBe('my_tool');
    });
  });

  describe('服务器列表管理', () => {
    it('初始时无服务器', () => {
      expect(manager.listServers()).toHaveLength(0);
    });

    it('初始时无发现的工具', () => {
      expect(manager.getDiscoveredTools()).toHaveLength(0);
      expect(manager.getToolDefinitions()).toHaveLength(0);
      expect(manager.getAgentTools()).toHaveLength(0);
    });

    it('disconnect 不存在的服务器不应报错', async () => {
      await expect(manager.disconnect('nonexistent')).resolves.toEqual({
        serverName: 'nonexistent',
        status: 'disconnected',
      });
    });

    it('disconnectAll 应正常完成', async () => {
      await expect(manager.disconnectAll()).resolves.toEqual([]);
    });
  });

  describe('getServerStatusSummary', () => {
    it('初始为空', () => {
      expect(manager.getServerStatusSummary()).toEqual([]);
    });

    it('connect 失败后应记录 error 状态且不留下连接', async () => {
      await expect(
        manager.connect({
          name: 'broken',
          type: 'stdio',
          // missing command → fail before spawn
        }),
      ).rejects.toThrow(/missing command/);

      expect(manager.listServers()).toHaveLength(0);
      expect(manager.getServerStatusSummary()).toEqual([
        {
          id: 'broken',
          name: 'broken',
          connectionStatus: 'error',
          toolCount: 0,
          tools: [],
          lastError: 'MCP stdio server "broken" missing command',
        },
      ]);
    });
  });

  describe('tool schema compilation at connect', () => {
    it('withholds only the tool whose schema cannot compile and validates the rest against their declared schema', async () => {
      const tools = [
        {
          name: 'lookup',
          inputSchema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            required: ['when'],
            properties: { when: { type: 'string', format: 'date', examples: ['2026-01-01'] } },
          },
        },
        { name: 'broken', inputSchema: { type: 'object', properties: { n: { type: 'string', format: 'banana' } } } },
      ];
      const server = createServer((request, response) => {
        let body = '';
        request.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
        request.on('end', () => {
          const { id, method } = JSON.parse(body) as { id: number; method: string };
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ jsonrpc: '2.0', id, result: method === 'tools/list' ? { tools } : {} }));
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const { port } = server.address() as AddressInfo;
        const names = await manager.connect({ name: 'fixture', type: 'http', url: `http://127.0.0.1:${port}/rpc` });
        expect(names).toEqual([buildMcpPrefixedName('fixture', 'lookup')]);
        expect(manager.getServerStatusSummary()[0]).toMatchObject({
          connectionStatus: 'connected',
          tools: ['lookup'],
          unavailableTools: [{ name: 'broken', reason: expect.stringMatching(/^MCP_TOOL_SCHEMA_UNSUPPORTED: /) }],
        });
        const [tool] = manager.getAgentTools();
        expect(tool.parameters).toEqual({
          type: 'object',
          required: ['when'],
          properties: { when: { type: 'string' } },
        });
        const declared = { name: tool.name, description: '', parameters: tool.argumentSchema ?? tool.parameters };
        expect(toolValidator.validate(declared, { when: '2026-11-26' })).toEqual({ when: '2026-11-26' });
        expect(() => toolValidator.validate(declared, { when: 'tomorrow' })).toThrow(/format "date"/);
      } finally {
        await manager.disconnectAll();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });
  });

  describe('executeTool — 无效名称', () => {
    it('无效的 prefixedName 应返回错误', async () => {
      const result = await manager.executeTool('invalid_name', {});
      expect(result.isError).toBe(true);
    });

    it('未连接服务器的工具应返回错误', async () => {
      const result = await manager.executeTool('mcp__unknown__tool', {});
      expect(result.isError).toBe(true);
    });

    it('aborted signal 应立即返回 isError', async () => {
      const controller = new AbortController();
      controller.abort();
      const result = await manager.executeTool('mcp__unknown__tool', {}, controller.signal);
      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({ type: 'text', text: 'MCP execute aborted' });
    });
  });
});
