/**
 * ToolSearch — 运行时工具发现 AgentTool。
 */
import type { AgentTool, AgentToolResult } from '../agent/AgentTool';

export function createToolSearchTool(getAllToolNames: () => string[]): AgentTool {
  return {
    name: 'tool_search',
    label: 'Search Tools',
    description: 'Search for available tools by name or description. Returns matching tools with their schemas.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search query (partial name match)' } },
      required: [],
    },
    permissionHint: 'readonly',
    async execute(_id, params) {
      const query = ((params as Record<string, unknown>).query as string)?.toLowerCase() ?? '';
      const all = getAllToolNames();
      const matches = query ? all.filter((n) => n.toLowerCase().includes(query)) : all;
      return {
        content: [{ type: 'text', text: matches.length > 0 ? `Found ${matches.length} tools:\n${matches.map((m) => `  - ${m}`).join('\n')}` : 'No matching tools found.' }],
        isError: false,
      } satisfies AgentToolResult;
    },
  };
}
