/**
 * ToolSearch — 运行时工具发现 AgentTool。
 */
import type { AgentTool, AgentToolResult } from '../agent/AgentTool';

export type ToolSearchToolInfo = Pick<AgentTool, 'name' | 'description' | 'parameters' | 'spec'>;

export interface ToolSearchParams {
  query?: string;
  category?: string;
  requires_approval?: boolean;
  limit?: number;
  offset?: number;
}

export interface ToolSearchMatch {
  name: string;
  description: string;
  category: string | undefined;
  requiresApproval: boolean;
  parameters: unknown;
}

export interface ToolSearchPage {
  total: number;
  offset: number;
  limit: number;
  matches: ToolSearchMatch[];
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function clampLimit(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(raw)));
}

function clampOffset(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.floor(raw));
}

export function searchTools(tools: ToolSearchToolInfo[], params: ToolSearchParams = {}): ToolSearchPage {
  const query = typeof params.query === 'string' ? params.query.trim().toLowerCase() : '';
  const category = typeof params.category === 'string' ? params.category.trim().toLowerCase() : '';
  const requiresApproval = typeof params.requires_approval === 'boolean'
    ? params.requires_approval
    : undefined;
  const limit = clampLimit(params.limit);
  const offset = clampOffset(params.offset);

  let matches = tools.slice();

  if (query) {
    matches = matches.filter((tool) => (
      tool.name.toLowerCase().includes(query)
      || tool.description.toLowerCase().includes(query)
    ));
  }
  if (category) {
    matches = matches.filter((tool) => (tool.spec?.category ?? '').toLowerCase() === category);
  }
  if (requiresApproval !== undefined) {
    matches = matches.filter((tool) => (tool.spec?.requiresApproval ?? false) === requiresApproval);
  }

  if (query) {
    matches.sort((a, b) => {
      const aNameHit = a.name.toLowerCase().includes(query);
      const bNameHit = b.name.toLowerCase().includes(query);
      if (aNameHit !== bNameHit) {
        return aNameHit ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  } else {
    matches.sort((a, b) => a.name.localeCompare(b.name));
  }

  const total = matches.length;
  const page = matches.slice(offset, offset + limit).map((tool) => ({
    name: tool.name,
    description: tool.description,
    category: tool.spec?.category,
    requiresApproval: tool.spec?.requiresApproval ?? false,
    parameters: tool.parameters ?? { type: 'object', properties: {} },
  }));

  return { total, offset, limit, matches: page };
}

export function formatToolSearchResult(page: ToolSearchPage): string {
  if (page.total === 0) {
    return 'No matching tools found.';
  }

  const start = page.matches.length === 0 ? 0 : page.offset + 1;
  const end = page.offset + page.matches.length;
  const rangeLabel = page.matches.length === 0
    ? `0 of ${page.total}`
    : `${start}-${end} of ${page.total}`;

  const blocks = page.matches.map((tool) => {
    const lines = [
      `- name: ${tool.name}`,
      `  description: ${tool.description}`,
      `  category: ${tool.category ?? '(none)'}`,
      `  requiresApproval: ${tool.requiresApproval}`,
      `  parameters: ${JSON.stringify(tool.parameters, null, 2).split('\n').join('\n  ')}`,
    ];
    return lines.join('\n');
  });

  return `Found ${page.total} tools (showing ${rangeLabel}):\n${blocks.join('\n')}`;
}

export function createToolSearchTool(getAllTools: () => ToolSearchToolInfo[]): AgentTool {
  return {
    name: 'tool_search',
    label: 'Search Tools',
    description: 'Search for available tools by name, description, category, or permission. Returns matching tools with their schemas.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (partial name or description match)' },
        category: { type: 'string', description: 'Filter by category (file, search, system, comm, web, task)' },
        requires_approval: { type: 'boolean', description: 'Filter by whether the tool requires approval' },
        limit: { type: 'number', description: `Max results to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})` },
        offset: { type: 'number', description: 'Result offset for pagination (default 0)' },
      },
      required: [],
    },
    spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: 'none', category: 'search', requiresApproval: false },
    permissionHint: 'readonly',
    async execute(_id, params) {
      const p = (params ?? {}) as ToolSearchParams;
      const page = searchTools(getAllTools(), p);
      return {
        content: [{ type: 'text', text: formatToolSearchResult(page) }],
        isError: false,
        details: page,
      } satisfies AgentToolResult;
    },
  };
}
