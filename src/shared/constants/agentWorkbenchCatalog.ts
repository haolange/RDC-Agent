import { DELEGATION_CAPSULE_JSON_SCHEMA } from '../types/delegationCapsule';
export type AgentWorkbenchToolPermission =
  | 'readonly'
  | 'mutation'
  | 'destructive'
  | 'approval';

export interface AgentWorkbenchToolDeclaration {
  id: string;
  permission: AgentWorkbenchToolPermission;
  inputSchema: Record<string, unknown>;
  icon: string;
  approvalRequired: boolean;
}

export interface AgentWorkbenchCommandDeclaration {
  command: string;
  relatedTools: string[];
  permission: AgentWorkbenchToolPermission;
}

export const AGENT_WORKBENCH_TOOL_CATALOG: AgentWorkbenchToolDeclaration[] = [
  {
    id: 'read_file',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
    icon: 'file-text',
    approvalRequired: false,
  },
  {
    id: 'artifact_read',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['uri'], properties: { uri: { type: 'string' } } },
    icon: 'file-symlink',
    approvalRequired: false,
  },
  {
    id: 'read_image',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
    icon: 'image',
    approvalRequired: false,
  },
  {
    id: 'glob',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['pattern'], properties: { pattern: { type: 'string' } } },
    icon: 'folder-search',
    approvalRequired: false,
  },
  {
    id: 'grep',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['pattern'], properties: { pattern: { type: 'string' }, path: { type: 'string' } } },
    icon: 'search',
    approvalRequired: false,
  },
  {
    id: 'web_fetch',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } },
    icon: 'globe',
    approvalRequired: false,
  },
  {
    id: 'web_search',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
    icon: 'search-check',
    approvalRequired: false,
  },
  {
    id: 'shell',
    permission: 'approval',
    inputSchema: { type: 'object', required: ['command'], properties: { command: { type: 'string' } } },
    icon: 'terminal',
    approvalRequired: true,
  },
  {
    id: 'write_file',
    permission: 'mutation',
    inputSchema: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } },
    icon: 'file-plus',
    approvalRequired: true,
  },
  {
    id: 'edit_file',
    permission: 'mutation',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, patch: { type: 'string' } } },
    icon: 'pencil',
    approvalRequired: true,
  },
  {
    id: 'delete_file',
    permission: 'destructive',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
    icon: 'file-x',
    approvalRequired: true,
  },
  {
    id: 'move_file',
    permission: 'mutation',
    inputSchema: {
      type: 'object',
      required: ['source', 'destination'],
      properties: { source: { type: 'string' }, destination: { type: 'string' } },
    },
    icon: 'file-input',
    approvalRequired: true,
  },
  {
    id: 'copy_file',
    permission: 'mutation',
    inputSchema: {
      type: 'object',
      required: ['source', 'destination'],
      properties: { source: { type: 'string' }, destination: { type: 'string' } },
    },
    icon: 'copy',
    approvalRequired: true,
  },
  {
    id: 'notebook_edit',
    permission: 'mutation',
    inputSchema: {
      type: 'object',
      required: ['notebook_path', 'cell_index', 'new_source'],
      properties: {
        notebook_path: { type: 'string' },
        cell_index: { type: 'integer' },
        new_source: { type: 'string' },
      },
    },
    icon: 'notebook',
    approvalRequired: false,
  },
  {
    id: 'git_status',
    permission: 'readonly',
    inputSchema: { type: 'object', properties: { short: { type: 'boolean' } } },
    icon: 'git-branch',
    approvalRequired: false,
  },
  {
    id: 'git_diff',
    permission: 'readonly',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, staged: { type: 'boolean' }, stat: { type: 'boolean' } },
    },
    icon: 'git-compare',
    approvalRequired: false,
  },
  {
    id: 'git_log',
    permission: 'readonly',
    inputSchema: { type: 'object', properties: { limit: { type: 'integer' } } },
    icon: 'git-commit',
    approvalRequired: false,
  },
  {
    id: 'git_add',
    permission: 'mutation',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
    icon: 'git-branch',
    approvalRequired: true,
  },
  {
    id: 'git_unstage',
    permission: 'mutation',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
    icon: 'git-branch',
    approvalRequired: true,
  },
  {
    id: 'git_commit',
    permission: 'mutation',
    inputSchema: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } },
    icon: 'git-commit',
    approvalRequired: true,
  },
  {
    id: 'turn_complete',
    permission: 'readonly',
    inputSchema: {
      type: 'object',
      required: ['disposition'],
      properties: {
        disposition: { type: 'string', enum: ['completed', 'partial', 'blocked', 'cancelled', 'budget_paused'] },
        evidenceRefs: {
          type: 'array',
          items: {
            type: 'object', required: ['uri', 'hash'],
            properties: { uri: { type: 'string' }, hash: { type: 'string' } },
          },
        },
      },
    },
    icon: 'check-circle',
    approvalRequired: false,
  },
  {
    id: 'subagent_report', permission: 'readonly',
    inputSchema: { type: 'object', required: ['kind', 'body'], properties: { kind: { type: 'string', enum: ['progress', 'blocked', 'decision_required'] }, body: { type: 'string' } } },
    icon: 'workflow', approvalRequired: false,
  },
  ...[
    'background_query',
    'background_wait',
    'background_result',
    'background_message',
    'background_cancel',
    'background_join',
  ].map((id) => ({
    id, permission: 'readonly' as const,
    inputSchema: { type: 'object', required: ['executionId'], properties: { executionId: { type: 'string' }, generation: { type: 'number' }, cursor: { type: 'number' }, body: { type: 'string' } } },
    icon: 'workflow', approvalRequired: false,
  })),
  {
    id: 'task_list',
    permission: 'readonly',
    inputSchema: { type: 'object', properties: {} },
    icon: 'list-checks',
    approvalRequired: false,
  },
  {
    id: 'task_create',
    permission: 'mutation',
    inputSchema: {
      type: 'object',
      required: ['tasks'],
      properties: {
        tasks: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['subject'],
            properties: {
              subject: { type: 'string' },
              description: { type: 'string' },
              blockedBy: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    icon: 'list-plus',
    approvalRequired: false,
  },
  {
    id: 'task_update',
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
    icon: 'list-todo',
    approvalRequired: false,
  },
  {
    id: 'task_get',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['taskId'], properties: { taskId: { type: 'string' } } },
    icon: 'list',
    approvalRequired: false,
  },
  {
    id: 'task_stop',
    permission: 'mutation',
    inputSchema: { type: 'object', required: ['taskId'], properties: { taskId: { type: 'string' } } },
    icon: 'list-x',
    approvalRequired: false,
  },
  {
    id: 'ask_user',
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
              required: { type: 'boolean' },
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
    icon: 'message-question',
    approvalRequired: false,
  },
  {
    id: 'subagent',
    permission: 'readonly',
    inputSchema: DELEGATION_CAPSULE_JSON_SCHEMA,
    icon: 'bot',
    approvalRequired: false,
  },
  {
    id: 'memory_search',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['scope'], properties: { scope: { type: 'string', enum: ['user', 'project'] }, query: { type: 'string' }, limit: { type: 'number' } } },
    icon: 'brain',
    approvalRequired: false,
  },
  {
    id: 'memory_read',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['scope', 'name'], properties: { scope: { type: 'string', enum: ['user', 'project'] }, name: { type: 'string' } } },
    icon: 'brain',
    approvalRequired: false,
  },
  {
    id: 'memory_write',
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
    icon: 'brain',
    approvalRequired: true,
  },
  {
    id: 'memory_delete',
    permission: 'mutation',
    inputSchema: { type: 'object', required: ['scope', 'name', 'confirmed'], properties: { scope: { type: 'string', enum: ['user', 'project'] }, name: { type: 'string' }, confirmed: { type: 'boolean' } } },
    icon: 'brain',
    approvalRequired: true,
  },
  {
    id: 'plan_artifact',
    permission: 'mutation',
    inputSchema: {
      type: 'object',
      required: ['title', 'summary', 'content'],
      properties: {
        title: { type: 'string' },
        summary: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4 },
        content: { type: 'string' },
      },
    },
    icon: 'file-check',
    approvalRequired: false,
  },
  {
    id: 'output_register',
    permission: 'mutation',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, title: { type: 'string' }, kind: { type: 'string' } } },
    icon: 'file-export',
    approvalRequired: false,
  },
  {
    id: 'skills',
    permission: 'readonly',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    icon: 'sparkles',
    approvalRequired: false,
  },
  {
    id: 'skill_read',
    permission: 'readonly',
    inputSchema: { type: 'object', required: ['skill_id'], properties: { skill_id: { type: 'string' } } },
    icon: 'sparkles',
    approvalRequired: false,
  },
  {
    id: 'mcp',
    permission: 'readonly',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    icon: 'plug',
    approvalRequired: false,
  },
  {
    id: 'tool_search',
    permission: 'readonly',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        category: { type: 'string' },
        requires_approval: { type: 'boolean' },
      },
    },
    icon: 'search',
    approvalRequired: false,
  },
  {
    id: 'runtime_context',
    permission: 'readonly',
    inputSchema: { type: 'object', properties: {} },
    icon: 'monitor-dot',
    approvalRequired: false,
  },
  {
    id: 'rdc_probe',
    permission: 'readonly',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['enumerate', 'doctor', 'version', 'probe', 'lease_open', 'lease_close', 'preview_status'],
        },
        capturePath: { type: 'string' },
        contextId: { type: 'string' },
        args: {
          type: 'object',
          additionalProperties: false,
          properties: {
            action: { type: 'string' },
            name: { type: 'string' },
          },
        },
      },
    },
    icon: 'radar',
    approvalRequired: false,
  },
  {
    id: 'code_interpreter',
    permission: 'approval',
    inputSchema: {
      type: 'object',
      required: ['code'],
      properties: {
        code: { type: 'string' },
        language: { type: 'string' },
      },
    },
    icon: 'terminal-square',
    approvalRequired: true,
  },
  {
    id: 'knowledge_browse',
    permission: 'readonly',
    inputSchema: {
      type: 'object',
      properties: {
        spaceId: { type: 'string' },
      },
    },
    icon: 'library',
    approvalRequired: false,
  },
  {
    id: 'knowledge_search',
    permission: 'readonly',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        spaceIds: { type: 'array', items: { type: 'string' } },
        lanes: { type: 'array', items: { type: 'string' } },
      },
    },
    icon: 'library-search',
    approvalRequired: false,
  },
  {
    id: 'knowledge_read',
    permission: 'readonly',
    inputSchema: {
      type: 'object',
      required: ['spaceId', 'relativePath'],
      properties: {
        spaceId: { type: 'string' },
        relativePath: { type: 'string' },
      },
    },
    icon: 'library-book',
    approvalRequired: false,
  },
  {
    id: 'knowledge_compile',
    permission: 'readonly',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        spaceIds: { type: 'array', items: { type: 'string' } },
        limit: { type: 'integer' },
      },
    },
    icon: 'library-stack',
    approvalRequired: false,
  },
  {
    id: 'knowledge_candidate_create',
    permission: 'mutation',
    inputSchema: {
      type: 'object',
      required: ['title', 'type', 'body', 'explicitUserIntent'],
      properties: {
        title: { type: 'string' },
        type: { type: 'string' },
        body: { type: 'string' },
        relativePath: { type: 'string' },
        spaceId: { type: 'string' },
        explicitUserIntent: { type: 'boolean' },
      },
    },
    icon: 'library-plus',
    approvalRequired: false,
  },
  {
    id: 'investigation_schema',
    permission: 'readonly',
    inputSchema: {
      type: 'object',
      required: ['kind'],
      properties: { kind: { type: 'string' } },
    },
    icon: 'file-search',
    approvalRequired: false,
  },
  {
    id: 'investigation_read',
    permission: 'readonly',
    inputSchema: {
      type: 'object',
      required: ['artifactId'],
      properties: {
        artifactId: { type: 'string' },
        expectedHash: { type: 'string' },
      },
    },
    icon: 'file-search',
    approvalRequired: false,
  },
  {
    id: 'investigation_write',
    permission: 'mutation',
    inputSchema: {
      type: 'object',
      required: ['kind', 'mission', 'title', 'summary', 'record'],
      properties: {
        kind: { type: 'string' },
        mission: { type: 'string' },
        title: { type: 'string' },
        summary: { type: 'string' },
        record: { type: 'object' },
        sourceRefs: { type: 'array' },
        supersedes: { type: 'string' },
        status: { type: 'string' },
      },
    },
    icon: 'file-plus',
    approvalRequired: false,
  },
  {
    id: 'investigation_list',
    permission: 'readonly',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        status: { type: 'string' },
      },
    },
    icon: 'list',
    approvalRequired: false,
  },
];

export const AGENT_WORKBENCH_COMMAND_CATALOG: AgentWorkbenchCommandDeclaration[] = [
  {
    command: '/help',
    relatedTools: [],
    permission: 'readonly',
  },
  {
    command: '/context',
    relatedTools: ['read_file', 'memory_read', 'runtime_context'],
    permission: 'readonly',
  },
  {
    command: '/memory',
    relatedTools: ['memory_read', 'plan_artifact', 'task_list'],
    permission: 'readonly',
  },
  {
    command: '/agents',
    relatedTools: ['skills'],
    permission: 'readonly',
  },
  {
    command: '/skills',
    relatedTools: ['skills'],
    permission: 'readonly',
  },
  {
    command: '/mcp',
    relatedTools: ['mcp'],
    permission: 'readonly',
  },
  {
    command: '/status',
    relatedTools: ['task_list', 'task_get', 'runtime_context'],
    permission: 'readonly',
  },
  {
    command: '/model',
    relatedTools: [],
    permission: 'readonly',
  },
];
