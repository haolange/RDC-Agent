/**
 * ToolSearch 纯函数与工厂测试。
 */
import { describe, expect, it } from 'vitest';
import type { AgentTool } from '../agent/AgentTool';
import {
  createToolSearchTool,
  formatToolSearchResult,
  searchTools,
  type ToolSearchToolInfo,
} from './ToolSearch';

function fakeTool(partial: {
  name: string;
  description?: string;
  category?: NonNullable<AgentTool['spec']>['category'];
  requiresApproval?: boolean;
  parameters?: ToolSearchToolInfo['parameters'];
}): ToolSearchToolInfo {
  return {
    name: partial.name,
    description: partial.description ?? `${partial.name} description`,
    parameters: partial.parameters ?? {
      type: 'object',
      properties: {
        q: { type: 'string' },
      },
    },
    spec: {
      isReadOnly: true,
      isConcurrencySafe: true,
      isDestructive: false,
      sideEffect: 'none',
      category: partial.category ?? 'search',
      requiresApproval: partial.requiresApproval ?? false,
    },
  };
}

describe('searchTools', () => {
  const catalog: ToolSearchToolInfo[] = [
    fakeTool({ name: 'write_file', description: 'Write content to a file', category: 'file', requiresApproval: true }),
    fakeTool({ name: 'read_file', description: 'Read a file from disk', category: 'file' }),
    fakeTool({ name: 'web_search', description: 'Search the web', category: 'web' }),
    fakeTool({ name: 'grep', description: 'Search file contents', category: 'search' }),
    fakeTool({ name: 'ask_user', description: 'Ask the user a question', category: 'comm', requiresApproval: false }),
  ];

  it('filters by query case-insensitively on name and description', () => {
    const page = searchTools(catalog, { query: 'SEARCH' });
    expect(page.total).toBe(2);
    expect(page.matches.map((m) => m.name)).toEqual(['web_search', 'grep']);
  });

  it('ranks name hits before description-only hits', () => {
    const page = searchTools(catalog, { query: 'file' });
    expect(page.matches.map((m) => m.name)).toEqual(['read_file', 'write_file', 'grep']);
  });

  it('discovers an exact named capability within a descriptive multi-word request without widening the effective set', () => {
    const tools = [fakeTool({ name: 'subagent', description: 'Delegate to an isolated sub-agent in background mode', category: 'task' }), fakeTool({ name: 'background_wait', category: 'task' })];
    expect(searchTools(tools, { query: 'subagent background isolated execution', category: 'task', requires_approval: false }).matches[0]?.name).toBe('subagent');
    expect(searchTools(tools, { query: 'subagent', category: 'web' }).total).toBe(0);
    expect(searchTools([tools[1]!], { query: 'subagent' }).total).toBe(0);
  });

  it('sorts by name when query is empty', () => {
    const page = searchTools(catalog, {});
    expect(page.matches.map((m) => m.name)).toEqual([
      'ask_user',
      'grep',
      'read_file',
      'web_search',
      'write_file',
    ]);
  });

  it('filters by category and requires_approval', () => {
    const page = searchTools(catalog, { category: 'file', requires_approval: true });
    expect(page.matches).toHaveLength(1);
    expect(page.matches[0]?.name).toBe('write_file');
    expect(page.matches[0]?.requiresApproval).toBe(true);
  });

  it('applies default limit 20 and clamps max to 50', () => {
    const many = Array.from({ length: 60 }, (_, i) => fakeTool({
      name: `tool_${String(i).padStart(2, '0')}`,
    }));
    const defaultPage = searchTools(many, {});
    expect(defaultPage.limit).toBe(20);
    expect(defaultPage.matches).toHaveLength(20);

    const capped = searchTools(many, { limit: 100 });
    expect(capped.limit).toBe(50);
    expect(capped.matches).toHaveLength(50);
  });

  it('paginates with offset/limit', () => {
    const page = searchTools(catalog, { offset: 1, limit: 2 });
    expect(page.total).toBe(5);
    expect(page.matches.map((m) => m.name)).toEqual(['grep', 'read_file']);
  });

  it('includes full parameters schema on each match', () => {
    const page = searchTools([
      fakeTool({
        name: 'custom',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      }),
    ], {});
    expect(page.matches[0]?.parameters).toEqual({
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    });
    expect(page.matches[0]?.category).toBe('search');
    expect(page.matches[0]?.description).toContain('custom');
  });
});

describe('formatToolSearchResult', () => {
  it('writes Found N tools (showing A-B of N) header and tool fields', () => {
    const page = searchTools([
      fakeTool({ name: 'alpha', description: 'First tool', category: 'system', requiresApproval: true }),
      fakeTool({ name: 'beta', description: 'Second tool', category: 'web' }),
    ], { limit: 1 });
    const text = formatToolSearchResult(page);
    expect(text).toContain('Found 2 tools (showing 1-1 of 2):');
    expect(text).toContain('name: alpha');
    expect(text).toContain('description: First tool');
    expect(text).toContain('category: system');
    expect(text).toContain('requiresApproval: true');
    expect(text).toContain('"type": "object"');
    expect(text).not.toContain('name: beta');
  });

  it('returns no-match message when empty', () => {
    const page = searchTools([], { query: 'task_create' });
    const text = formatToolSearchResult(page);
    expect(text).toContain('NO_MATCH_IN_EFFECTIVE_TOOL_SET');
    expect(text).toContain('authoritative for these search filters only');
    expect(text).toContain(page.scopeFingerprint);
  });
});

describe('createToolSearchTool', () => {
  it('executes against injected tool list', async () => {
    const tool = createToolSearchTool(() => [
      fakeTool({ name: 'zeta' }),
      fakeTool({ name: 'alpha', description: 'Alpha helper' }),
    ]);
    const result = await tool.execute('call-1', { query: 'alpha' });
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).toContain('Found 1 tools (showing 1-1 of 1):');
    expect(text).toContain('name: alpha');
    expect(result.isError).toBe(false);
  });

  it('returns structured authoritative no-match details for the effective tool set', async () => {
    const tool = createToolSearchTool(() => [fakeTool({ name: 'task_list' })]);
    const result = await tool.execute('call-2', { query: 'task_create' });
    expect(result.details).toMatchObject({
      code: 'NO_MATCH_IN_EFFECTIVE_TOOL_SET',
      authoritative: true,
      total: 0,
    });
    expect((result.details as { scopeFingerprint: string }).scopeFingerprint).toMatch(/^[a-f0-9]{24}$/u);
  });
});
