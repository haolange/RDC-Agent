/**
 * RuntimeToolAssembly — resolveRuntimeTools / workbench / MCP catalog tools.
 */

import type { AgentRole } from '@shared/types/agent';
import type { MCPServerStatusSummary } from '@shared/types/mcp';
import type { WorkflowStage } from '@shared/types/workflow';
import type { ConversationAskUserQuestion } from '@shared/types/conversation';
import { generateEventId, nowMs } from '@shared/utils/id';
import { normalizeAskUserQuestions } from '@shared/utils/askUser';
import type { AgentTool } from '../../agent-runtime/agent/AgentTool';
import { toolToDefinition } from '../../agent-runtime/agent/AgentTool';
import type { ToolDefinition } from '../../agent-runtime/core/types';
import { createToolSearchTool, getPrimitiveTools } from '../../agent-runtime/tools';
import { HANDOFF_ERROR } from '@shared/types/profileHandoff';
import { handoffController } from '../../agent-runtime/agent/HandoffController';
import { isHandoffDeclaredModelValid } from '../../sessions/profileHandoffModel';
import { settingsService } from '../../settings/SettingsService';
import { MemoryStore } from '../../agent-runtime/memory/MemoryStore';
import { createTaskTools, TaskRegistry, MemoryTaskStore, createSessionTaskStore, projectTaskItems } from '../../agent-runtime/tasks';
import { traceProjectionRefreshService } from '../../agent-trace/TraceProjectionRefreshService';
import { assertRdxContextLeaseOwnership } from '../../sessions/RdxRuntimeContextRegistry';
import { storageAdapter } from '../../sessions/StorageAdapter';
import { dispatchRuntimeHooks } from '../../hooks/runtimeHookDispatch';
import { createOutputRegistrationTool } from '../../reports/OutputRegistrationTool';
import { createKnowledgeTools } from '../../knowledge/KnowledgeTools';
import { agentRuntimeConfigService } from '../../settings/AgentRuntimeConfigService';
import {
  expandCanonicalToolToken,
  isToolAllowedByFrozenAllowlist,
  normalizeToolName,
} from './DebuggerRuntimePolicy';
import type { TurnHandle } from './TurnCoordinator';
import type { McpConnectionCoordinator } from './McpConnectionCoordinator';
import type { ResolvedRuntimeTools } from './orchestratorTypes';

export interface RuntimeToolAssemblyDeps {
  mcp: McpConnectionCoordinator;
  getActiveTurn: (sessionId?: string | null) => TurnHandle | null;
  getMemoryStore: (scope: 'user' | 'project', projectRootPath?: string | null) => MemoryStore;
  createSubagentTools: (parentAgentId: AgentRole, sessionId?: string | null, turnHandle?: TurnHandle | null) => AgentTool[];
  getMcpServerStatusSummary: (projectRootPath?: string | null, query?: string) => MCPServerStatusSummary[];
}

export class RuntimeToolAssembly {
  constructor(private readonly deps: RuntimeToolAssemblyDeps) {}

  createToolSignature(tools: ToolDefinition[]): string {
    return tools.map((tool) => tool.name).sort().join('|');
  }

  matchesToolAllowlist(toolName: string, toolAllowlist: string[]): boolean {
    const normalizedToolName = normalizeToolName(toolName);
    return toolAllowlist.some((entry) => expandCanonicalToolToken(entry).some((expandedEntry) => {
      const normalizedEntry = normalizeToolName(expandedEntry);
      if (normalizedEntry === '*' || normalizedEntry === normalizedToolName) {
        return true;
      }
      if (normalizedEntry.endsWith('.*') && normalizedToolName.startsWith(normalizedEntry.slice(0, -1))) {
        return true;
      }
      if (normalizedEntry.endsWith('*') && normalizedToolName.startsWith(normalizedEntry.slice(0, -1))) {
        return true;
      }
      return false;
    }));
  }

  isAllowedForRuntime(
    agentId: AgentRole,
    toolName: string,
    stage?: WorkflowStage | 'report',
    frozenToolAllowlist?: readonly string[],
  ): boolean {
    void stage;
    return isToolAllowedByFrozenAllowlist(toolName, agentId, frozenToolAllowlist ?? []);
  }

  createTaskRuntimeTools(sessionId?: string | null, turnHandle?: TurnHandle | null): AgentTool[] {
    // subagent（sessionId 含 ::subagent:: 段）用 MemoryTaskStore，随子 context 结束回收；
    // 顶层 agent 用会话级 FileTaskStore 落盘（${userData}/state/tasks/{sessionId}），供「进度」泳道按会话读取。
    const resolvedSessionId = sessionId ?? turnHandle?.eventSink?.sessionId ?? null;
    const isSubagent = resolvedSessionId?.includes('::subagent::') ?? false;
    const store = isSubagent || !resolvedSessionId
      ? new MemoryTaskStore()
      : createSessionTaskStore(resolvedSessionId);
    const registry = new TaskRegistry(store);
    // 桥接 task 变更为 AgentEvent，激活 ConversationService 的 task.* 投影。
    registry.onTaskChange = ({ type, task }) => {
      if (resolvedSessionId && !isSubagent) {
        traceProjectionRefreshService.schedule(resolvedSessionId);
      }
      const sink = turnHandle?.eventSink ?? this.deps.getActiveTurn(resolvedSessionId)?.eventSink;
      const onEvent = sink?.onEvent;
      if (!onEvent) return;
      if (turnHandle && !turnHandle.isLive(turnHandle.generation)) return;
      void registry.listTasks().then((tasks) => {
        if (turnHandle && !turnHandle.isLive(turnHandle.generation)) return;
        onEvent({
          id: generateEventId('agent-event'),
          type: type === 'created' ? 'task.created' : 'task.updated',
          timestamp: nowMs(),
          sessionId: sink.sessionId ?? null,
          agentId: sink.agentId,
          payload: {
            taskId: task.id,
            title: task.subject,
            status: task.status,
            statusReason: task.statusReason,
            snapshot: projectTaskItems(tasks),
          },
        });
      });
    };
    return createTaskTools(registry);
  }

  createRdxContextTool(sessionId?: string | null, projectId?: string | null): AgentTool<Record<string, never>, { available: boolean }> {
    return {
      name: 'rdx_context',
      label: 'RDX Context',
      description: 'Read the current stable RDX runtime context captured by configured shell actions.',
      pollable: true,
      parameters: {
        type: 'object',
        properties: {},
      },
      permissionHint: 'readonly',
      spec: { isReadOnly: true, isConcurrencySafe: false, isDestructive: false, sideEffect: 'session', category: 'system', requiresApproval: false },
      async execute() {
        const lease = assertRdxContextLeaseOwnership({
          sessionId,
          projectId,
        });
        const runtimeContext = lease?.runtimeContext ?? null;
        if (!runtimeContext) {
          return {
            content: [{
              type: 'text',
              text: sessionId
                ? 'No RDX runtime context lease is owned by this session.'
                : 'RDX runtime context requires an owning sessionId (no global fallback).',
            }],
            details: { available: false },
          };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify(runtimeContext, null, 2) }],
          details: { available: true },
        };
      },
    };
  }

  createAskUserTool(agentId: AgentRole): AgentTool<
    { questions?: unknown[] },
    { agentId: AgentRole; questions: ConversationAskUserQuestion[] }
  > {
    return {
      name: 'ask_user',
      label: 'Ask User',
      description: 'Ask the user for a decision or missing information. Use this when progress depends on user input.',
      parameters: {
        type: 'object',
        required: ['questions'],
        properties: {
          questions: {
            type: 'array',
            minItems: 1,
            description: 'Batch of user questions. A single question is represented as an array with one item.',
            items: {
              type: 'object',
              required: ['prompt'],
              properties: {
                questionId: { type: 'string', description: 'Optional stable question id. Runtime generates one when omitted.' },
                prompt: { type: 'string', description: 'The concise question to ask the user.' },
                description: { type: 'string', description: 'Optional supporting context shown below the question title.' },
                allowFreeform: { type: 'boolean', description: 'Whether the user may type a custom answer. Defaults to true.' },
                options: {
                  type: 'array',
                  description: 'Optional mutually exclusive choices.',
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
      spec: { isReadOnly: true, isConcurrencySafe: false, isDestructive: false, sideEffect: 'session', category: 'comm', requiresApproval: false },
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

  createAgentHandoffTool(
    agentId: AgentRole,
    sessionId?: string | null,
    turnHandle?: TurnHandle | null,
  ): AgentTool<
    { agent?: string; label?: string; prompt?: string },
    { fromAgentId: AgentRole; toAgentId: string; label: string; prompt: string; valid: boolean }
  > {
    const getActiveTurn = this.deps.getActiveTurn;
    const capturedTurn = turnHandle ?? getActiveTurn(sessionId);
    return {
      name: 'agent_handoff',
      label: 'Agent Handoff',
      description: 'Request a handoff to another agent profile. The runtime validates the target against the current profile handoffs and prepares the receiving prompt. The actual profile switch is applied by the orchestrator after this turn.',
      parameters: {
        type: 'object',
        required: ['agent'],
        properties: {
          agent: { type: 'string', description: 'Target agent profile id, such as edit, debugger, analyzer, or optimizer.' },
          label: { type: 'string', description: 'Short handoff label. Defaults to the declared handoff label.' },
          prompt: { type: 'string', description: 'Implementation or specialist prompt for the receiving agent. Defaults to the declared handoff prompt.' },
        },
      },
      permissionHint: 'readonly',
      spec: { isReadOnly: true, isConcurrencySafe: false, isDestructive: false, sideEffect: 'session', category: 'comm', requiresApproval: false },
      async execute(_toolCallId, args) {
        const toProfile = typeof args.agent === 'string' ? args.agent.trim() : '';
        const turn = capturedTurn ?? getActiveTurn(sessionId);
        const resolvedSessionId = sessionId ?? turn?.eventSink?.sessionId ?? null;
        const sourceRequestId = turn?.eventSink?.requestId?.trim() || '';
        const sourceTurnId = turn?.turnId ?? '';
        const store = storageAdapter.handoffs;
        const nextChain = resolvedSessionId
          ? store.computeNextChain(resolvedSessionId, agentId, sourceTurnId || undefined)
          : { chainRoot: `handoff-root-${agentId}`, depth: 1 };
        const resolved = handoffController.resolve(
          agentId,
          toProfile,
          typeof args.prompt === 'string' ? args.prompt : undefined,
          typeof args.label === 'string' ? args.label : undefined,
          turn?.runtimePlan
            ? {
                sourceHandoffs: turn.runtimePlan.profileHandoffs,
                enabledProfileIds: turn.runtimePlan.enabledProfileIds,
                sessionId: resolvedSessionId ?? undefined,
                hasActiveHandoff: resolvedSessionId ? Boolean(store.getActive(resolvedSessionId)) : false,
                nextDepth: nextChain.depth,
                chainRoot: nextChain.chainRoot,
                isDeclaredModelValid: (canonical) => isHandoffDeclaredModelValid(canonical, settingsService.getAll()),
              }
            : undefined,
        );
        if (!resolved.valid || !resolved.request) {
          return {
            content: [{
              type: 'text',
              text: `${resolved.code ?? 'HANDOFF_REJECTED'}: ${resolved.reason ?? 'unknown reason'}`,
            }],
            isError: true,
            details: {
              fromAgentId: agentId,
              toAgentId: toProfile,
              label: '',
              prompt: '',
              valid: false,
              code: resolved.code,
            },
          };
        }
        const { toProfile: target, label, prompt, send, declaredModel, chainRoot, depth } = resolved.request;
        if (!resolvedSessionId || !sourceTurnId || !sourceRequestId) {
          return {
            content: [{ type: 'text', text: `${HANDOFF_ERROR.STATE_CONFLICT}: handoff requires a session-owned turn.` }],
            isError: true,
            details: { fromAgentId: agentId, toAgentId: target, label, prompt, valid: false },
          };
        }
        const projectRoot = turn?.runtimePlan?.projectRootPath ?? undefined;
        const handoffAllowed = await dispatchRuntimeHooks('agent.before-handoff', {
          agentId,
          sessionId: resolvedSessionId,
          projectRoot,
          payload: { toAgentId: target, label, prompt },
        });
        if (!handoffAllowed) {
          return {
            content: [{ type: 'text', text: 'HOOK_DENIED: agent.before-handoff' }],
            isError: true,
            details: { fromAgentId: agentId, toAgentId: target, label, prompt, valid: false },
          };
        }
        try {
          const prepared = store.prepare(resolvedSessionId, {
            sourceTurnId,
            sourceRequestId,
            sourceAgentId: agentId,
            toAgentId: target,
            prompt,
            label,
            declaredModel,
            send,
            chainRoot,
            depth,
          });
          await dispatchRuntimeHooks('agent.after-handoff', {
            agentId,
            sessionId: resolvedSessionId,
            projectRoot,
            payload: { toAgentId: target, handoffId: prepared.handoffId, label },
          });
          if (turn) {
            turn.pendingHandoff = {
              turnId: sourceTurnId,
              fromAgentId: agentId,
              toProfile: target as AgentRole,
              prompt,
              label,
              sessionId: resolvedSessionId,
            };
          }
          return {
            content: [{
              type: 'text',
              text: `Handoff prepared from ${agentId} to ${target}: ${label}\n${prompt}`,
            }],
            details: {
              fromAgentId: agentId,
              toAgentId: target,
              label,
              prompt,
              valid: true,
              handoffId: prepared.handoffId,
              send: prepared.send,
            },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text', text: message }],
            isError: true,
            details: { fromAgentId: agentId, toAgentId: target, label, prompt, valid: false },
          };
        }
      },
    };
  }

  createPlanArtifactTool(sessionId?: string | null): AgentTool<
    { title?: string; content?: string },
    { sessionId: string | null; artifactPath?: string }
  > {
    return {
      name: 'plan_artifact',
      label: 'Write Plan Artifact',
      description: 'Write or replace the current session plan artifact. This cannot edit arbitrary workspace files.',
      parameters: {
        type: 'object',
        required: ['content'],
        properties: {
          title: { type: 'string', description: 'Optional plan title.' },
          content: { type: 'string', description: 'Plan content to persist for this session.' },
        },
      },
      permissionHint: 'session_mutation',
      async execute(_toolCallId, args) {
        if (!sessionId) {
          return {
            content: [{ type: 'text', text: 'No active session is available for a plan artifact.' }],
            isError: true,
            details: { sessionId: null },
          };
        }
        const body = typeof args.content === 'string' ? args.content.trim() : '';
        if (!body) {
          return {
            content: [{ type: 'text', text: 'Plan artifact content is required.' }],
            isError: true,
            details: { sessionId },
          };
        }
        const title = typeof args.title === 'string' && args.title.trim()
          ? args.title.trim()
          : 'Agent Plan';
        const artifactPath = storageAdapter.writeSessionPlanArtifact(sessionId, `# ${title}\n\n${body}\n`);
        return {
          content: [{ type: 'text', text: `Plan artifact saved: ${artifactPath}` }],
          details: { sessionId, artifactPath },
        };
      },
    };
  }

  createMemorySearchTool(sessionId?: string | null): AgentTool<
    { scope: 'user' | 'project'; query?: string; limit?: number },
    { sessionId: string | null; scope: 'user' | 'project'; count: number }
  > {
    const resolveStore = (scope: 'user' | 'project', projectRootPath?: string | null) => this.deps.getMemoryStore(scope, projectRootPath);
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
      async execute(_id, args, _signal, _update, context) {
        const records = await resolveStore(args.scope, context?.projectRootPath).searchMemories(args.query ?? '', args.limit ?? 20);
        return { content: [{ type: 'text', text: records.length ? records.map((record) => `- ${record.displayName}: ${record.description}`).join('\n') : 'No matching memories were found.' }], details: { sessionId: sessionId ?? null, scope: args.scope, count: records.length } };
      },
    };
  }

  createMemoryReadTool(sessionId?: string | null): AgentTool<
    { scope: 'user' | 'project'; name: string },
    { sessionId: string | null; scope: 'user' | 'project'; count: number }
  > {
    const resolveStore = (scope: 'user' | 'project', projectRootPath?: string | null) => this.deps.getMemoryStore(scope, projectRootPath);
    return {
      name: 'memory_read',
      label: 'Read Memory',
      description: 'Read one explicitly saved memory by exact name and scope.',
      parameters: { type: 'object', required: ['scope', 'name'], properties: {
        scope: { type: 'string', enum: ['user', 'project'] },
        name: { type: 'string' },
      } },
      permissionHint: 'readonly',
      async execute(_id, args, _signal, _update, context) {
        const record = await resolveStore(args.scope, context?.projectRootPath).getMemory(args.name);
        return { content: [{ type: 'text', text: record ? `# ${record.displayName}\n\n${record.description}\n\n${record.content}` : `No memory named "${args.name}" was found.` }], details: { sessionId: sessionId ?? null, scope: args.scope, count: record ? 1 : 0 } };
      },
    };
  }

  createMemoryWriteTool(): AgentTool<
    { scope: 'user' | 'project'; name: string; description: string; type: string; content: string; tags?: string[]; approved: boolean },
    { scope: 'user' | 'project'; name: string; created: boolean }
  > {
    const resolveStore = (scope: 'user' | 'project', projectRootPath?: string | null) => this.deps.getMemoryStore(scope, projectRootPath);
    const validTypes = new Set(['user', 'feedback', 'project', 'reference']);
    return {
      name: 'memory_write',
      label: 'Write Memory',
      description: 'Persist a memory only after explicit user intent or interactive approval. Scope must be declared.',
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
      async execute(_toolCallId, args, _signal, _update, context) {
        if (args.approved !== true) {
          return { content: [{ type: 'text', text: 'Memory write requires explicit user approval.' }], isError: true, details: { scope: args.scope, name: args.name, created: false } };
        }
        const type = validTypes.has(args.type) ? (args.type as 'user' | 'feedback' | 'project' | 'reference') : 'project';
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

  createMemoryDeleteTool(): AgentTool<
    { scope: 'user' | 'project'; name: string; confirmed: boolean },
    { scope: 'user' | 'project'; name: string; deleted: boolean }
  > {
    const resolveStore = (scope: 'user' | 'project', projectRootPath?: string | null) => this.deps.getMemoryStore(scope, projectRootPath);
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

  createSkillsCatalogTool(): AgentTool<
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
      async execute(_toolCallId, args, _signal, _onUpdate, context) {
        const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
        const skills = agentRuntimeConfigService.listSkills(context?.projectRootPath ?? undefined)
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

  createSkillReadTool(agentId: AgentRole): AgentTool<
    { skill_id?: string },
    { skillId: string; agentId: AgentRole }
  > {
    return {
      name: 'skill_read',
      label: 'Read Skill',
      description: 'Load the full SKILL.md instructions for one discovered effective skill.',
      parameters: {
        type: 'object',
        required: ['skill_id'],
        properties: {
          skill_id: { type: 'string', description: 'Skill id, for example rdc-context.' },
        },
      },
      permissionHint: 'readonly',
      async execute(_toolCallId, args, _signal, _onUpdate, context) {
        const skillKey = typeof args.skill_id === 'string' ? args.skill_id.trim() : '';
        if (!skillKey) {
          return {
            content: [{ type: 'text', text: 'skill_id is required.' }],
            isError: true,
            details: { skillId: '', agentId },
          };
        }

        const skill = agentRuntimeConfigService.loadSkill(skillKey, context?.projectRootPath ?? undefined);
        if (!skill) {
          return {
            content: [{ type: 'text', text: `Skill is not configured: ${skillKey}` }],
            isError: true,
            details: { skillId: skillKey, agentId },
          };
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

  createMcpCatalogTool(): AgentTool<
    { query?: string },
    { count: number; servers: MCPServerStatusSummary[] }
  > {
    const getMcpServerStatusSummary = this.deps.getMcpServerStatusSummary;
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
      async execute(_toolCallId, args, _signal, _onUpdate, context) {
        const query = typeof args.query === 'string' ? args.query : undefined;
        const servers = getMcpServerStatusSummary(context?.projectRootPath ?? null, query);
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

  createWorkbenchTools(agentId: AgentRole, sessionId?: string | null, turnHandle?: TurnHandle | null): AgentTool[] {
    return [
      this.createAskUserTool(agentId),
      this.createAgentHandoffTool(agentId, sessionId, turnHandle),
      this.createMemorySearchTool(sessionId),
      this.createMemoryReadTool(sessionId),
      this.createMemoryWriteTool(),
      this.createMemoryDeleteTool(),
      this.createPlanArtifactTool(sessionId),
      createOutputRegistrationTool({
        sessionId,
        runId: turnHandle?.runId,
        projectRootPath: turnHandle?.eventSink?.projectRootPath,
      }) as unknown as AgentTool,
      this.createSkillsCatalogTool(),
      this.createSkillReadTool(agentId),
      this.createMcpCatalogTool(),
      ...createKnowledgeTools(sessionId),
      ...this.deps.createSubagentTools(agentId, sessionId, turnHandle),
    ];
  }

  resolveRuntimeTools(
    agentId: AgentRole,
    toolAllowlist: string[],
    stage?: WorkflowStage | 'report',
    sessionId?: string | null,
    turnHandle?: TurnHandle | null,
    projectId?: string | null,
    projectRootPath?: string | null,
    mcpPoolKey?: string | null,
  ): ResolvedRuntimeTools {
    const availableTools = new Map<string, AgentTool>();
    for (const tool of getPrimitiveTools()) {
      availableTools.set(normalizeToolName(tool.name), tool);
    }
    for (const tool of this.createTaskRuntimeTools(sessionId, turnHandle)) {
      availableTools.set(normalizeToolName(tool.name), tool);
    }
    const rdxContextTool = this.createRdxContextTool(sessionId, projectId ?? turnHandle?.eventSink?.projectId ?? null);
    availableTools.set(rdxContextTool.name, rdxContextTool);
    for (const tool of this.createWorkbenchTools(agentId, sessionId, turnHandle)) {
      availableTools.set(normalizeToolName(tool.name), tool);
    }
    for (const tool of this.deps.mcp.getAgentTools(
      projectRootPath ?? turnHandle?.eventSink?.projectRootPath ?? null,
      mcpPoolKey ?? null,
    )) {
      availableTools.set(normalizeToolName(tool.name), tool);
    }
    // tool_search 只能发现 allowlist + runtime policy 过滤后的工具集，
    // 否则模型会看到（并尝试调用）本轮被禁止的工具。
    const toolSearchTool = createToolSearchTool(() =>
      Array.from(availableTools.values()).filter((tool) =>
        this.matchesToolAllowlist(tool.name, toolAllowlist)
        && this.isAllowedForRuntime(agentId, tool.name, stage, toolAllowlist),
      ),
    );
    availableTools.set(normalizeToolName(toolSearchTool.name), toolSearchTool);

    const definitions: ToolDefinition[] = [];
    const toolMap = new Map<string, AgentTool>();
    for (const tool of availableTools.values()) {
      if (!this.matchesToolAllowlist(tool.name, toolAllowlist)) continue;
      if (!this.isAllowedForRuntime(agentId, tool.name, stage, toolAllowlist)) continue;
      const normalized = normalizeToolName(tool.name);
      if (!toolMap.has(normalized)) {
        toolMap.set(normalized, tool);
        definitions.push(toolToDefinition(tool));
      }
    }
    return { definitions, toolMap };
  }
}
