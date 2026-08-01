/**
 * Deferred 工具划分纯函数测试（mcp__* 与 extended builtin 同机制）。
 */
import { describe, expect, it } from 'vitest';
import {
  MCP_TOOL_NAME_PREFIX,
  extractDeferredToolNamesFromToolSearchDetails,
  isDeferredToolName,
  isMcpPrefixedToolName,
  partitionDeferredTools,
  preactivateTaskTools,
} from './deferredTools';

describe('isMcpPrefixedToolName', () => {
  it('matches MCPManager mcp__ prefix', () => {
    expect(MCP_TOOL_NAME_PREFIX).toBe('mcp__');
    expect(isMcpPrefixedToolName('mcp__filesystem__read')).toBe(true);
    expect(isMcpPrefixedToolName('read_file')).toBe(false);
    expect(isMcpPrefixedToolName('mcp.')).toBe(false);
  });
});

describe('isDeferredToolName', () => {
  it('treats mcp__* and extended builtin as deferred', () => {
    expect(isDeferredToolName('mcp__fs__list')).toBe(true);
    expect(isDeferredToolName('delete_file')).toBe(true);
    expect(isDeferredToolName('memory_write')).toBe(true);
    expect(isDeferredToolName('task_create')).toBe(true);
    expect(isDeferredToolName('git_commit')).toBe(true);
  });

  it('keeps core builtin and unknown tools injected', () => {
    expect(isDeferredToolName('read_file')).toBe(false);
    expect(isDeferredToolName('bash')).toBe(false);
    expect(isDeferredToolName('tool_search')).toBe(false);
    expect(isDeferredToolName('skills')).toBe(false);
    expect(isDeferredToolName('skill_read')).toBe(false);
    expect(isDeferredToolName('rdx_context')).toBe(false);
    expect(isDeferredToolName('custom_unknown_tool')).toBe(false);
  });
});

describe('preactivateTaskTools', () => {
  it('activates the complete granted task surface in canonical order', () => {
    const activated = new Set<string>(['mcp__fs__read']);
    preactivateTaskTools([
      { name: 'task_create' },
      { name: 'task_update' },
      { name: 'task_get' },
      { name: 'output_register' },
      { name: 'task_list' },
      { name: 'task_stop' },
    ], activated);
    expect([...activated]).toEqual([
      'mcp__fs__read',
      'task_create',
      'task_update',
      'task_get',
      'task_list',
      'task_stop',
      'output_register',
    ]);
  });

  it('activates only the read-only task tools granted to Ask', () => {
    const readOnly = new Set<string>();
    preactivateTaskTools([{ name: 'task_list' }, { name: 'task_get' }], readOnly);
    expect([...readOnly]).toEqual(['task_get', 'task_list']);
  });
});
describe('partitionDeferredTools', () => {
  const defs = [
    { name: 'read_file' },
    { name: 'tool_search' },
    { name: 'mcp__fs__list' },
    { name: 'mcp__fs__read' },
    { name: 'delete_file' },
    { name: 'task_create' },
  ];

  it('defers all mcp__ and extended builtin tools when none are activated', () => {
    const { injected, deferredMcp, deferredBuiltin } = partitionDeferredTools(defs, new Set());
    expect(injected.map((d) => d.name)).toEqual(['read_file', 'tool_search']);
    expect(deferredMcp.map((d) => d.name)).toEqual(['mcp__fs__list', 'mcp__fs__read']);
    expect(deferredBuiltin.map((d) => d.name)).toEqual(['delete_file', 'task_create']);
  });

  it('appends activated deferred tools at the tail in activation order', () => {
    const activated = new Set<string>();
    activated.add('task_create');
    activated.add('mcp__fs__read');
    const { injected, deferredMcp, deferredBuiltin } = partitionDeferredTools(defs, activated);
    // core 前缀稳定，激活工具按激活顺序追加尾部（保 prompt cache 前缀）。
    expect(injected.map((d) => d.name)).toEqual([
      'read_file',
      'tool_search',
      'task_create',
      'mcp__fs__read',
    ]);
    expect(deferredMcp.map((d) => d.name)).toEqual(['mcp__fs__list']);
    expect(deferredBuiltin.map((d) => d.name)).toEqual(['delete_file']);
  });

  it('ignores activated names that are not available', () => {
    const { injected } = partitionDeferredTools(defs, new Set(['mcp__other__tool']));
    expect(injected.map((d) => d.name)).toEqual(['read_file', 'tool_search']);
  });
});

describe('extractDeferredToolNamesFromToolSearchDetails', () => {
  it('returns mcp__ and extended builtin names from tool_search matches', () => {
    expect(extractDeferredToolNamesFromToolSearchDetails({
      total: 4,
      matches: [
        { name: 'read_file' },
        { name: 'mcp__server__tool' },
        { name: 'memory_write' },
        { name: 'bash' },
      ],
    })).toEqual(['mcp__server__tool', 'memory_write']);
  });

  it('returns empty for malformed details', () => {
    expect(extractDeferredToolNamesFromToolSearchDetails(null)).toEqual([]);
    expect(extractDeferredToolNamesFromToolSearchDetails({})).toEqual([]);
    expect(extractDeferredToolNamesFromToolSearchDetails({ matches: 'x' })).toEqual([]);
  });
});
