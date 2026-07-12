/**
 * MCP deferred loading 纯函数测试。
 */
import { describe, expect, it } from 'vitest';
import {
  MCP_TOOL_NAME_PREFIX,
  extractMcpToolNamesFromToolSearchDetails,
  isMcpPrefixedToolName,
  partitionDeferredMcpTools,
} from './mcpDeferredTools';

describe('isMcpPrefixedToolName', () => {
  it('matches MCPManager mcp__ prefix', () => {
    expect(MCP_TOOL_NAME_PREFIX).toBe('mcp__');
    expect(isMcpPrefixedToolName('mcp__filesystem__read')).toBe(true);
    expect(isMcpPrefixedToolName('read_file')).toBe(false);
    expect(isMcpPrefixedToolName('mcp.')).toBe(false);
  });
});

describe('partitionDeferredMcpTools', () => {
  const defs = [
    { name: 'read_file' },
    { name: 'tool_search' },
    { name: 'mcp__fs__list' },
    { name: 'mcp__fs__read' },
    { name: 'subagent' },
  ];

  it('defers all mcp__ tools when none are activated', () => {
    const { injected, deferredMcp } = partitionDeferredMcpTools(defs, new Set());
    expect(injected.map((d) => d.name)).toEqual(['read_file', 'tool_search', 'subagent']);
    expect(deferredMcp.map((d) => d.name)).toEqual(['mcp__fs__list', 'mcp__fs__read']);
  });

  it('injects only activated mcp__ tools', () => {
    const { injected, deferredMcp } = partitionDeferredMcpTools(
      defs,
      new Set(['mcp__fs__read']),
    );
    expect(injected.map((d) => d.name)).toEqual([
      'read_file',
      'tool_search',
      'mcp__fs__read',
      'subagent',
    ]);
    expect(deferredMcp.map((d) => d.name)).toEqual(['mcp__fs__list']);
  });
});

describe('extractMcpToolNamesFromToolSearchDetails', () => {
  it('returns only mcp__ names from tool_search matches', () => {
    expect(extractMcpToolNamesFromToolSearchDetails({
      total: 2,
      matches: [
        { name: 'read_file' },
        { name: 'mcp__server__tool' },
      ],
    })).toEqual(['mcp__server__tool']);
  });

  it('returns empty for malformed details', () => {
    expect(extractMcpToolNamesFromToolSearchDetails(null)).toEqual([]);
    expect(extractMcpToolNamesFromToolSearchDetails({})).toEqual([]);
    expect(extractMcpToolNamesFromToolSearchDetails({ matches: 'x' })).toEqual([]);
  });
});
