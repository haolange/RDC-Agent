/**
 * WorkbenchTools — session workbench tools: ask_user, the scoped memory tools, the Skill
 * catalog and reader, and the MCP service catalog.
 */

import path from 'node:path';
import { AppError } from '@shared/errors/appError';
import { normalizeAskUserQuestions } from '@shared/utils/askUser';
import { readFileTool } from '../tools/primitives/ReadFileTool';
import { agentRuntimeConfigService } from '../../settings/agent-manifests/AgentRuntimeConfigService';
import type { McpConnectionCoordinator } from './McpConnectionCoordinator';
import type { ScopedMemoryStores } from '../memory/MemoryStore';
import type { AgentTool } from '../agent/AgentTool';
import type { ConversationAskUserQuestion } from '@shared/types/conversation';
import type { MCPServerStatusSummary } from '@shared/types/mcp';
import type { AgentRole } from '@shared/types/agent';

export function createAskUserTool(agentId: AgentRole): AgentTool<
  { questions?: unknown[] },
  { agentId: AgentRole; questions: ConversationAskUserQuestion[] }
> {
  return {
    name: 'ask_user',
    label: 'Ask User',
    description: 'Help form the user goal, scope, expected result and acceptance criteria, or request information that materially changes the plan. Read available materials first; ask a few progressive questions without requiring a diagnosis. Unknown and optional skip are supported. Answers do not grant approval.',
    parameters: {
      type: 'object',
      required: ['questions'],
      properties: {
        questions: {
          type: 'array',
          minItems: 1,
          description: 'Ask one to three questions per round when useful; continue progressively after answers instead of front-loading a questionnaire. A single question is an array with one item.',
          items: {
            type: 'object',
            required: ['prompt'],
            properties: {
              questionId: { type: 'string', description: 'Optional stable question id. Runtime generates one when omitted.' },
              prompt: { type: 'string', description: 'The concise question to ask the user.' },
              description: { type: 'string', description: 'Optional supporting context shown below the question title.' },
              allowFreeform: { type: 'boolean', description: 'Whether the user may type a custom answer. Defaults to true.' },
              required: { type: 'boolean', description: 'Set false for questions the user may explicitly skip. Unknown is always available. Answers form requirements, never mutation approval.' },
              options: {
                type: 'array',
                description: 'Optional mutually exclusive SINGLE-SELECT choices. Never say multiple selection is available; the user can supplement freely.',
                items: {
                  type: 'object',
                  required: ['label'],
                  properties: {
                    optionId: { type: 'string', description: 'Optional stable option id. Runtime generates one when omitted.' },
                    label: { type: 'string', description: 'Short option label.' },
                    description: { type: 'string', description: 'Optional one-line option detail.' },
                  },
                },
              },
            },
          },
        },
      },
    },
    permissionHint: 'readonly',
    spec: { isReadOnly: true, concurrency: 'exclusive', isDestructive: false, sideEffect: 'session', category: 'comm', requiresApproval: false,
      interaction: 'user-input' },
    async execute(_toolCallId, args) {
      const questions = normalizeAskUserQuestions(args);
      return {
        content: [{
          type: 'text',
          text: questions.length > 0
            ? 'ask_user requires the conversation interaction bridge.'
            : 'ask_user requires at least one canonical questions[] entry with a prompt.',
        }],
        isError: true,
        details: { agentId, questions },
      };
    },
  };
}

export function createMemorySearchTool(memory: ScopedMemoryStores, sessionId?: string | null): AgentTool<
  { scope: 'user' | 'project'; query?: string; limit?: number },
  { sessionId: string | null; scope: 'user' | 'project'; count: number }
> {
  const resolveStore = (scope: 'user' | 'project', projectRootPath?: string | null) => memory.memoryStore(scope, projectRootPath);
  return {
    name: 'memory_search',
    label: 'Search Memory',
    description: 'Search explicitly saved memories in one declared scope. Memory is never injected automatically.',
    parameters: { type: 'object', required: ['scope'], properties: {
      scope: { type: 'string', enum: ['user', 'project'] },
      query: { type: 'string' },
      limit: { type: 'number' },
    } },
    permissionHint: 'readonly',
    spec: { isReadOnly: true, concurrency: 'exclusive', isDestructive: false, sideEffect: 'none' },
    async execute(_id, args, _signal, _update, context) {
      const records = await resolveStore(args.scope, context?.projectRootPath).searchMemories(args.query ?? '', args.limit ?? 20);
      return { content: [{ type: 'text', text: records.length ? records.map((record) => `- ${record.displayName}: ${record.description}`).join('\n') : 'No matching memories were found.' }], details: { sessionId: sessionId ?? null, scope: args.scope, count: records.length } };
    },
  };
}

export function createMemoryReadTool(memory: ScopedMemoryStores, sessionId?: string | null): AgentTool<
  { scope: 'user' | 'project'; name: string },
  { sessionId: string | null; scope: 'user' | 'project'; count: number }
> {
  const resolveStore = (scope: 'user' | 'project', projectRootPath?: string | null) => memory.memoryStore(scope, projectRootPath);
  return {
    name: 'memory_read',
    label: 'Read Memory',
    description: 'Read one explicitly saved memory by exact name and scope.',
    parameters: { type: 'object', required: ['scope', 'name'], properties: {
      scope: { type: 'string', enum: ['user', 'project'] },
      name: { type: 'string' },
    } },
    permissionHint: 'readonly',
    spec: { isReadOnly: true, concurrency: 'exclusive', isDestructive: false, sideEffect: 'none' },
    async execute(_id, args, _signal, _update, context) {
      const record = await resolveStore(args.scope, context?.projectRootPath).getMemory(args.name);
      return { content: [{ type: 'text', text: record ? `# ${record.displayName}\n\n${record.description}\n\n${record.content}` : `No memory named "${args.name}" was found.` }], details: { sessionId: sessionId ?? null, scope: args.scope, count: record ? 1 : 0 } };
    },
  };
}

export function createMemoryWriteTool(memory: ScopedMemoryStores): AgentTool<
  { scope: 'user' | 'project'; name: string; description: string; type: string; content: string; tags?: string[]; approved: boolean },
  { scope: 'user' | 'project'; name: string; created: boolean }
> {
  const resolveStore = (scope: 'user' | 'project', projectRootPath?: string | null) => memory.memoryStore(scope, projectRootPath);
  const validTypes = new Set(['user', 'feedback', 'project', 'reference']);
  return {
    name: 'memory_write',
    label: 'Write Memory',
    description: 'Persist a memory only after explicit user intent or interactive approval. Scope must be declared. type must be user, feedback, project, or reference; other types are rejected.',
    parameters: {
      type: 'object',
      required: ['scope', 'name', 'description', 'type', 'content', 'approved'],
      properties: {
        scope: { type: 'string', enum: ['user', 'project'] },
        name: { type: 'string', description: 'Kebab-case memory name (unique key).' },
        description: { type: 'string', description: 'One-line summary.' },
        type: { type: 'string', description: 'user | feedback | project | reference' },
        content: { type: 'string', description: 'Full Markdown body.' },
        tags: { type: 'array', items: { type: 'string' } },
        approved: { type: 'boolean', description: 'True only after the user explicitly requested or approved this write.' },
      },
    },
    permissionHint: 'mutation',
    spec: { isReadOnly: false, concurrency: 'exclusive', isDestructive: false, sideEffect: 'filesystem' },
    async execute(_toolCallId, args, _signal, _update, context) {
      if (args.approved !== true) {
        return { content: [{ type: 'text', text: 'Memory write requires explicit user approval.' }], isError: true, details: { scope: args.scope, name: args.name, created: false } };
      }
      if (!validTypes.has(args.type)) {
        return { content: [{ type: 'text', text: `Memory type must be one of ${[...validTypes].join(', ')}.` }], isError: true, details: { scope: args.scope, name: args.name, created: false } };
      }
      const type = args.type as 'user' | 'feedback' | 'project' | 'reference';
      const record = await resolveStore(args.scope, context?.projectRootPath).writeMemory({
        name: args.name.trim(),
        description: args.description.trim(),
        type,
        content: args.content,
        tags: Array.isArray(args.tags) ? args.tags : undefined,
      });
      return {
        content: [{ type: 'text', text: `Memory saved: ${record.displayName} (${record.type})` }],
        details: { scope: args.scope, name: record.displayName, storageKey: record.name, created: true },
      };
    },
  };
}

export function createMemoryDeleteTool(memory: ScopedMemoryStores): AgentTool<
  { scope: 'user' | 'project'; name: string; confirmed: boolean },
  { scope: 'user' | 'project'; name: string; deleted: boolean }
> {
  const resolveStore = (scope: 'user' | 'project', projectRootPath?: string | null) => memory.memoryStore(scope, projectRootPath);
  return {
    name: 'memory_delete',
    label: 'Delete Memory',
    description: 'Delete one scoped memory only after explicit confirmation.',
    parameters: {
      type: 'object',
      required: ['scope', 'name', 'confirmed'],
      properties: {
        scope: { type: 'string', enum: ['user', 'project'] },
        name: { type: 'string', description: 'Memory name to delete.' },
        confirmed: { type: 'boolean' },
      },
    },
    permissionHint: 'mutation',
    spec: { isReadOnly: false, concurrency: 'exclusive', isDestructive: true, sideEffect: 'filesystem' },
    async execute(_toolCallId, args, _signal, _update, context) {
      if (args.confirmed !== true) {
        return { content: [{ type: 'text', text: 'Memory deletion requires explicit confirmation.' }], isError: true, details: { scope: args.scope, name: args.name, deleted: false } };
      }
      const deleted = await resolveStore(args.scope, context?.projectRootPath).deleteMemory(args.name.trim());
      return {
        content: [{
          type: 'text',
          text: deleted ? `Memory deleted: ${args.name}` : `No memory named "${args.name}" was found.`,
        }],
        details: { scope: args.scope, name: args.name, deleted },
      };
    },
  };
}

export function createSkillsCatalogTool(agentId: AgentRole): AgentTool<
  { query?: string },
  { count: number }
> {
  return {
    name: 'skills',
    label: 'List Skills',
    description: 'List reusable skills configured for the current workspace.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional case-insensitive filter.' },
      },
    },
    permissionHint: 'readonly',
    spec: { isReadOnly: true, concurrency: 'exclusive', isDestructive: false, sideEffect: 'none' },
    async execute(_toolCallId, args, _signal, _onUpdate, context) {
      const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
      const skills = agentRuntimeConfigService.listSkills(context?.projectRootPath ?? undefined, agentId)
        .filter((skill) => !query || `${skill.id} ${skill.name} ${skill.label} ${skill.description}`.toLowerCase().includes(query));
      const lines = skills.map((skill) => (
        `${skill.id}: ${skill.label || skill.name} (${skill.source})`
      ));
      return {
        content: [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : 'No configured skills matched the query.' }],
        details: { count: skills.length },
      };
    },
  };
}

export function createSkillReadTool(agentId: AgentRole): AgentTool<
  { skill_id?: string; reference?: string; offset?: number; limit?: number },
  { skillId: string; agentId: AgentRole }
> {
  return {
    name: 'skill_read',
    label: 'Read Skill',
    description: 'Read one discovered effective Skill. Without reference, returns the full SKILL.md. To read a linked method reference, pass its Skill-relative references/... path plus optional 1-based offset/limit; returns whole-file SHA-256 and truncation metadata. This reads knowledge only and never changes frozen tool permissions or grants editing access. Do not resolve Skill links relative to the project workspace.',
    parameters: {
      type: 'object',
      required: ['skill_id'],
      properties: {
        skill_id: { type: 'string', description: 'Skill id, for example rdc-context.' },
        reference: { type: 'string', description: 'Exact Skill-relative text path under references/, for example references/tools.md. No absolute paths, traversal or symlinks.' },
        offset: { type: 'integer', minimum: 1, description: 'Reference start line, 1-based; only valid with reference.' },
        limit: { type: 'integer', minimum: 1, maximum: 5000, description: 'Reference line window; defaults to 2000, at most 5000.' },
      },
    },
    permissionHint: 'readonly',
    spec: { isReadOnly: true, concurrency: 'exclusive', isDestructive: false, sideEffect: 'none' },
    async execute(_toolCallId, args, signal, _onUpdate, context) {
      const skillKey = typeof args.skill_id === 'string' ? args.skill_id.trim() : '';
      if (!skillKey) {
        return {
          content: [{ type: 'text', text: 'skill_id is required.' }],
          isError: true,
          details: { skillId: '', agentId },
        };
      }

      const skill = agentRuntimeConfigService.loadSkill(skillKey, context?.projectRootPath ?? undefined, agentId);
      if (!skill) {
        return {
          content: [{ type: 'text', text: `Skill is not configured: ${skillKey}` }],
          isError: true,
          details: { skillId: skillKey, agentId },
        };
      }

      if (args.reference !== undefined) {
        const reference = args.reference;
        const parts = typeof reference === 'string' ? reference.replace(/\\/gu, '/').split('/') : [];
        if (parts[0] !== 'references' || parts.length < 2
          || parts.some((part) => !part || part === '.' || part === '..' || part.includes(':')
            || [...part].some((char) => char.charCodeAt(0) < 32))) {
          throw new AppError('SKILL_REFERENCE_PATH_DENIED', 'use an exact relative path under this Skill references/ directory.');
        }
        // Reuse canonical file guards/windowing, but never inherit workspace
        // roots or successfulFileReads: method knowledge cannot grant edits.
        const root = path.dirname(skill.sourcePath);
        const result = await readFileTool.execute(_toolCallId, {
          path: parts.join('/'), offset: args.offset, limit: args.limit,
        }, signal, undefined, { workspaceRoot: root, projectRootPath: root, projectId: null, sessionId: null });
        return {
          content: result.content,
          details: { skillId: skill.id, agentId, sourcePath: skill.sourcePath, sourceHash: skill.sourceHash, scope: skill.scope, reference: result.details },
        };
      }
      if (args.offset !== undefined || args.limit !== undefined) {
        throw new AppError('SKILL_REFERENCE_REQUIRED', 'offset/limit require a reference path.');
      }

      return {
        content: [{ type: 'text', text: skill.instructions }],
        details: {
          skillId: skill.id,
          agentId,
          name: skill.name,
          description: skill.description,
          sourcePath: skill.sourcePath,
        },
      };
    },
  };
}

export function createMcpCatalogTool(mcp: Pick<McpConnectionCoordinator, 'getMcpServerStatusSummary'>): AgentTool<
  { query?: string },
  { count: number; servers: MCPServerStatusSummary[] }
> {
  return {
    name: 'mcp',
    label: 'List MCP Services',
    description: 'List MCP services configured for the current workspace, including connection status and tools.',
    pollable: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Optional case-insensitive filter.' },
      },
    },
    permissionHint: 'readonly',
    spec: { isReadOnly: true, concurrency: 'exclusive', isDestructive: false, sideEffect: 'none' },
    async execute(_toolCallId, args, _signal, _onUpdate, context) {
      const query = typeof args.query === 'string' ? args.query : undefined;
      const servers = mcp.getMcpServerStatusSummary(context?.projectRootPath ?? null, query);
      const lines = servers.map((server) => {
        const toolNames = (server.tools ?? []).slice(0, 12);
        const toolsLabel = toolNames.length > 0
          ? toolNames.join(', ') + ((server.tools?.length ?? 0) > toolNames.length ? ', …' : '')
          : '(none)';
        const errorLine = server.lastError ? `\n  lastError: ${server.lastError}` : '';
        return [
          `${server.id}: ${server.name}`,
          `  connectionStatus: ${server.connectionStatus}`,
          `  toolCount: ${server.toolCount}`,
          `  tools: ${toolsLabel}${errorLine}`,
        ].join('\n');
      });
      return {
        content: [{ type: 'text', text: lines.length > 0 ? lines.join('\n') : 'No configured MCP services matched the query.' }],
        details: { count: servers.length, servers },
      };
    },
  };
}
