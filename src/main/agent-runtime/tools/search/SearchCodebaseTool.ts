import type { AgentTool, AgentToolResult } from '../../agent/AgentTool';

interface SearchCodebaseParams {
  query: string;
  limit?: number;
}

interface SearchCodebaseDetails {
  query: string;
  results: string[];
}

export const searchCodebaseTool: AgentTool<SearchCodebaseParams, SearchCodebaseDetails> = {
  name: 'search_codebase',
  label: '语义搜索代码库',
  description: 'Search the codebase using semantic meaning (not exact text). Useful for finding logic by intent when you do not know exact file names.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'High-level description of what you are looking for.' },
      limit: { type: 'integer', description: 'Maximum results to return (default: 10).' },
    },
    required: ['query'],
  },
  spec: { isReadOnly: true, isConcurrencySafe: true, isDestructive: false, sideEffect: 'none', category: 'search', requiresApproval: false },
  permissionHint: 'readonly',

  async execute(_toolCallId, params) {
    const limit = Math.max(1, Math.min(50, Math.floor(params.limit ?? 10)));
    const query = params.query.trim();
    if (!query) {
      return { content: [{ type: 'text', text: 'Query is empty.' }], details: { query, results: [] } };
    }
    // Semantic search requires an index; fallback to a placeholder result.
    const results = [
      `Semantic search for "${query}" is not yet indexed.`,
      'Consider using grep (exact regex) or glob (file patterns) for now.',
    ];
    return {
      content: [{ type: 'text', text: results.slice(0, limit).join('\n') }],
      details: { query, results: results.slice(0, limit) },
    } satisfies AgentToolResult<SearchCodebaseDetails>;
  },
};
