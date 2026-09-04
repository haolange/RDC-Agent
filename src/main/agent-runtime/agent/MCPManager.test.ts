/**
 * MCPManager 单元测试。
 * 测试核心逻辑：工具名称前缀、解析、工具注册/发现。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  MCPManager,
  buildMcpPrefixedName,
  decodeMcpNameSegment,
  encodeMcpNameSegment,
} from './MCPManager';

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
