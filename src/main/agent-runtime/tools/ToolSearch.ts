/**
 * ToolSearch — 运行时工具发现 AgentTool。
 */
import type { AgentTool, AgentToolResult } from '../agent/AgentTool';

export function createToolSearchTool(getAllTools: () => Pick<AgentTool, 'name' | 'description' | 'spec'>[]): AgentTool {
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
      },
      required: [],
    },
    spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: 'none', category: 'search', requiresApproval: false },
    permissionHint: 'readonly',
    async execute(_id, params) {
      const p = params as Record<string, unknown>;
      const query = (p.query as string)?.toLowerCase() ?? '';
      const category = (p.category as string)?.toLowerCase() ?? '';
      const requiresApproval = p.requires_approval as boolean | undefined;
      const all = getAllTools();
      let matches = all;
      if (query) {
        matches = matches.filter((t) =>
          t.name.toLowerCase().includes(query) || t.description.toLowerCase().includes(query),
        );
      }
      if (category) {
        matches = matches.filter((t) => t.spec?.category === category);
      }
      if (requiresApproval !== undefined) {
        matches = matches.filter((t) => (t.spec?.requiresApproval ?? false) === requiresApproval);
      }
      const text = matches.length > 0
        ? `Found ${matches.length} tools:\n${matches.map((m) => `  - ${m.name}${m.spec ? ` [${m.spec.category}]` : ''}`).join('\n')}`
        : 'No matching tools found.';
      return {
        content: [{ type: 'text', text }],
        isError: false,
      } satisfies AgentToolResult;
    },
  };
}
