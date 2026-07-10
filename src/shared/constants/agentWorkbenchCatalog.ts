export type AgentWorkbenchToolPermission =
  | 'readonly'
  | 'mutation'
  | 'destructive'
  | 'approval';

export interface AgentWorkbenchToolDeclaration {
  id: string;
  label: string;
  permission: AgentWorkbenchToolPermission;
  inputSchema: Record<string, unknown>;
  resultSummary: string;
  icon: string;
  approvalRequired: boolean;
}

export interface AgentWorkbenchCommandDeclaration {
  command: string;
  label: string;
  description: string;
  relatedTools: string[];
  permission: AgentWorkbenchToolPermission;
}

export const AGENT_WORKBENCH_TOOL_CATALOG: AgentWorkbenchToolDeclaration[] = [
  {
    id: 'read_file',
    label: 'Read File',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
    resultSummary: 'Returns text content from a workspace file.',
    icon: 'file-text',
    approvalRequired: false,
  },
  {
    id: 'glob',
    label: 'Glob',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['pattern'], properties: { pattern: { type: 'string' } } },
    resultSummary: 'Lists workspace paths matching a glob pattern.',
    icon: 'folder-search',
    approvalRequired: false,
  },
  {
    id: 'grep',
    label: 'Grep',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['pattern'], properties: { pattern: { type: 'string' }, path: { type: 'string' } } },
    resultSummary: 'Returns matching text locations from workspace files.',
    icon: 'search',
    approvalRequired: false,
  },
  {
    id: 'web_fetch',
    label: 'Web Fetch',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } },
    resultSummary: 'Fetches public HTTP(S) page text.',
    icon: 'globe',
    approvalRequired: false,
  },
  {
    id: 'web_search',
    label: 'Web Search',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
    resultSummary: 'Searches public web results.',
    icon: 'search-check',
    approvalRequired: false,
  },
  {
    id: 'bash',
    label: 'Shell',
    permission: 'approval',
    inputSchema: { type: 'object', required: ['command'], properties: { command: { type: 'string' } } },
    resultSummary: 'Runs an approved workspace command and returns stdout/stderr.',
    icon: 'terminal',
    approvalRequired: true,
  },
  {
    id: 'write_file',
    label: 'Write File',
    permission: 'mutation',
    inputSchema: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } },
    resultSummary: 'Writes a workspace file after policy approval.',
    icon: 'file-plus',
    approvalRequired: true,
  },
  {
    id: 'edit_file',
    label: 'Edit File',
    permission: 'mutation',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, patch: { type: 'string' } } },
    resultSummary: 'Edits a workspace file after policy approval.',
    icon: 'pencil',
    approvalRequired: true,
  },
  {
    id: 'task_list',
    label: 'Tasks',
    permission: 'readonly',
    inputSchema: { type: 'object', properties: {} },
    resultSummary: 'Summarizes current task or plan state.',
    icon: 'list-checks',
    approvalRequired: false,
  },
  {
    id: 'task_create',
    label: 'Create Task',
    permission: 'mutation',
    inputSchema: {
      type: 'object',
      required: ['subject'],
      properties: {
        subject: { type: 'string' },
        description: { type: 'string' },
        activeForm: { type: 'string' },
        blockedBy: { type: 'array', items: { type: 'string' } },
      },
    },
    resultSummary: 'Creates a private agent task record in workspace user space.',
    icon: 'list-plus',
    approvalRequired: false,
  },
  {
    id: 'task_update',
    label: 'Update Task',
    permission: 'mutation',
    inputSchema: {
      type: 'object',
      required: ['taskId'],
      properties: {
        taskId: { type: 'string' },
        status: { type: 'string' },
        subject: { type: 'string' },
        description: { type: 'string' },
      },
    },
    resultSummary: 'Updates status or metadata for a private agent task record.',
    icon: 'list-todo',
    approvalRequired: false,
  },
  {
    id: 'task_get',
    label: 'Get Task',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['taskId'], properties: { taskId: { type: 'string' } } },
    resultSummary: 'Reads a private agent task record by id.',
    icon: 'list',
    approvalRequired: false,
  },
  {
    id: 'ask_user',
    label: 'Ask User',
    permission: 'approval',
    inputSchema: {
      type: 'object',
      required: ['questions'],
      properties: {
        questions: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['prompt'],
            properties: {
              questionId: { type: 'string' },
              prompt: { type: 'string' },
              description: { type: 'string' },
              allowFreeform: { type: 'boolean' },
              options: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['label'],
                  properties: {
                    optionId: { type: 'string' },
                    label: { type: 'string' },
                    description: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    resultSummary: 'Surfaces one or more user questions and resolves them as structured answers.',
    icon: 'message-question',
    approvalRequired: false,
  },
  {
    id: 'agent_handoff',
    label: 'Agent Handoff',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['prompt'], properties: { agent: { type: 'string' }, label: { type: 'string' }, prompt: { type: 'string' } } },
    resultSummary: 'Creates an implementation or specialist handoff summary.',
    icon: 'route',
    approvalRequired: false,
  },
  {
    id: 'memory_search',
    label: 'Search Memory',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['scope'], properties: { scope: { type: 'string', enum: ['user', 'project'] }, query: { type: 'string' }, limit: { type: 'number' } } },
    resultSummary: 'Searches explicitly saved memories in one declared scope.',
    icon: 'brain',
    approvalRequired: false,
  },
  {
    id: 'memory_read',
    label: 'Memory',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['scope', 'name'], properties: { scope: { type: 'string', enum: ['user', 'project'] }, name: { type: 'string' } } },
    resultSummary: 'Reads one explicitly saved memory by scope and name.',
    icon: 'brain',
    approvalRequired: false,
  },
  {
    id: 'memory_write',
    label: 'Write Memory',
    permission: 'mutation',
    inputSchema: {
      type: 'object',
      required: ['scope', 'name', 'description', 'type', 'content', 'approved'],
      properties: {
        scope: { type: 'string', enum: ['user', 'project'] },
        name: { type: 'string' },
        description: { type: 'string' },
        type: { type: 'string' },
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        approved: { type: 'boolean' },
      },
    },
    resultSummary: 'Persists an explicitly approved memory to one declared scope.',
    icon: 'brain',
    approvalRequired: true,
  },
  {
    id: 'memory_delete',
    label: 'Delete Memory',
    permission: 'mutation',
    inputSchema: { type: 'object', required: ['scope', 'name', 'confirmed'], properties: { scope: { type: 'string', enum: ['user', 'project'] }, name: { type: 'string' }, confirmed: { type: 'boolean' } } },
    resultSummary: 'Deletes one scoped memory after explicit confirmation.',
    icon: 'brain',
    approvalRequired: true,
  },
  {
    id: 'plan_artifact',
    label: 'Plan Artifact',
    permission: 'mutation',
    inputSchema: { type: 'object', required: ['content'], properties: { title: { type: 'string' }, content: { type: 'string' } } },
    resultSummary: 'Writes the current plan to the active session artifact.',
    icon: 'file-check',
    approvalRequired: false,
  },
  {
    id: 'skills',
    label: 'Skills',
    permission: 'readonly',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    resultSummary: 'Lists configured reusable skills.',
    icon: 'sparkles',
    approvalRequired: false,
  },
  {
    id: 'mcp',
    label: 'MCP',
    permission: 'readonly',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    resultSummary: 'Lists configured MCP services.',
    icon: 'plug',
    approvalRequired: false,
  },
  {
    id: 'rdx_context',
    label: 'RDX Context',
    permission: 'readonly',
    inputSchema: { type: 'object', properties: {} },
    resultSummary: 'Reads current RDC/RDX runtime context.',
    icon: 'monitor-dot',
    approvalRequired: false,
  },
];

export const AGENT_WORKBENCH_COMMAND_CATALOG: AgentWorkbenchCommandDeclaration[] = [
  {
    command: '/help',
    label: 'Help',
    description: 'Show available profile commands and tool boundaries.',
    relatedTools: [],
    permission: 'readonly',
  },
  {
    command: '/compact',
    label: 'Compact',
    description: 'Request context compaction when the profile can manage context.',
    relatedTools: ['memory_read'],
    permission: 'readonly',
  },
  {
    command: '/context',
    label: 'Context',
    description: 'Summarize current project, session, captures, and available context.',
    relatedTools: ['read_file', 'memory_read', 'rdx_context'],
    permission: 'readonly',
  },
  {
    command: '/memory',
    label: 'Memory',
    description: 'Inspect profile-accessible memory.',
    relatedTools: ['memory_read', 'plan_artifact', 'task_list'],
    permission: 'readonly',
  },
  {
    command: '/agents',
    label: 'Agents',
    description: 'List profiles and handoff options visible to the current profile.',
    relatedTools: ['agent_handoff'],
    permission: 'readonly',
  },
  {
    command: '/skills',
    label: 'Skills',
    description: 'List configured skills visible to the current profile.',
    relatedTools: ['skills'],
    permission: 'readonly',
  },
  {
    command: '/mcp',
    label: 'MCP',
    description: 'List configured MCP services visible to the current profile.',
    relatedTools: ['mcp'],
    permission: 'readonly',
  },
  {
    command: '/status',
    label: 'Status',
    description: 'Summarize runtime, route, tool, and capture status.',
    relatedTools: ['task_list', 'task_get', 'rdx_context'],
    permission: 'readonly',
  },
  {
    command: '/model',
    label: 'Model',
    description: 'Show the active model route for this profile.',
    relatedTools: [],
    permission: 'readonly',
  },
];
