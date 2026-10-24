/**
 * RuntimeToolAssembly — resolveRuntimeTools / workbench / MCP catalog tools.
 */

import type { AgentRole } from '@shared/types/agent';
import { TASK_EXECUTION_REQUIREMENTS_JSON_SCHEMA } from '@shared/types/taskExecution';
import path from 'node:path';
import type { MCPServerStatusSummary } from '@shared/types/mcp';
import type { ConversationAskUserQuestion } from '@shared/types/conversation';
import { normalizeAskUserQuestions } from '@shared/utils/askUser';
import type { AgentTool } from '../../agent-runtime/agent/AgentTool';
import { toolToDefinition } from '../../agent-runtime/agent/AgentTool';
import type { ToolDefinition } from '../../agent-runtime/core/types';
import { createToolSearchTool, getPrimitiveTools } from '../../agent-runtime/tools';
import { readFileTool } from '../../agent-runtime/tools/primitives/ReadFileTool';
import { MemoryStore } from '../../agent-runtime/memory/MemoryStore';
import { TaskRegistry, createSessionTaskStore, getDelegatedTaskScope } from '../../agent-runtime/tasks';
import { assertRdcContextLeaseOwnership, getRdcContextLease } from '../../sessions/RdcRuntimeContextRegistry';
import { rdcSessionService } from '../../sessions';
import { createOutputRegistrationTool } from '../../reports/OutputRegistrationTool';
import { createKnowledgeTools } from '../../knowledge/KnowledgeTools';
import { createInvestigationTools } from '../../investigation/InvestigationTools';
import { agentRuntimeConfigService } from '../../settings/AgentRuntimeConfigService';
import {
  expandCanonicalToolToken,
  isToolAllowedByFrozenAllowlist,
  normalizeToolName,
} from './DebuggerRuntimePolicy';
import { isRdcLeaseToolName } from '@shared/constants/rdcLeaseTools';
import { createRdcProbeTool } from './RdcProbeTool';
import { readRdcHostControls } from '../../tools/RdcHostControls';
import type { TurnCompletionDeclaration, TurnHandle } from './TurnCoordinator';
import type { McpConnectionCoordinator } from './McpConnectionCoordinator';
import type { ResolvedRuntimeTools } from './orchestratorTypes';
import { createTaskRuntimeTools as assembleTaskRuntimeTools } from './TaskRuntimeTools';
import { enforceMissionTurnCompletion } from '../../investigation/missionCompletionContract';
import { listUnfinishedDirectTasks } from './DirectTaskTurnLifecycle';

export interface RuntimeToolAssemblyDeps {
  mcp: McpConnectionCoordinator;
  getActiveTurn: (sessionId?: string | null) => TurnHandle | null;
  getMemoryStore: (scope: 'user' | 'project', projectRootPath?: string | null) => MemoryStore;
  createSubagentTools: (parentAgentId: AgentRole, sessionId?: string | null, turnHandle?: TurnHandle | null) => AgentTool[];
  createBackgroundTools?: (parentAgentId: AgentRole, sessionId?: string | null, turnHandle?: TurnHandle | null) => AgentTool[];
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
    frozenToolAllowlist?: readonly string[],
    excludeRdcLeaseTools?: boolean,
  ): boolean {
    if (excludeRdcLeaseTools && isRdcLeaseToolName(toolName)) {
      return false;
    }
    return isToolAllowedByFrozenAllowlist(toolName, agentId, frozenToolAllowlist ?? []);
  }

  createTaskRuntimeTools(sessionId?: string | null, turnHandle?: TurnHandle | null): AgentTool[] {
    return assembleTaskRuntimeTools({ sessionId, turnHandle, getActiveTurn: this.deps.getActiveTurn });
  }

  createTurnCompletionTool(turnHandle?: TurnHandle | null, validate?: (value: TurnCompletionDeclaration) => void | Promise<void>): AgentTool {
    return {
      name: 'turn_complete',
      label: 'Complete Turn',
      description: 'Declare structured turn completion. Use only when the requested work is complete, partial, blocked, cancelled, or paused by budget.',
      parameters: {
        type: 'object',
        required: ['disposition'],
        properties: {
          disposition: { type: 'string', enum: ['completed', 'partial', 'blocked', 'cancelled', 'budget_paused'] },
          evidenceRefs: {
            type: 'array', items: { type: 'object', required: ['uri', 'hash'], properties: { uri: { type: 'string' }, hash: { type: 'string' } } },
          },
          result: {
            type: 'object', required: ['summary', 'outputs', 'counterevidence', 'unresolved', 'scope', 'sideEffects', 'recoveryState'], additionalProperties: false,
            properties: {
              summary: { type: 'string', maxLength: 4000 }, outputs: { type: 'object', description: 'Named string outputs matching the Task completion requirements. Serialize structured values as strings.' },
              counterevidence: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 2000 } },
              unresolved: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 2000 } },
              scope: { type: 'string', maxLength: 4000 }, sideEffects: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 2000 } },
              recoveryState: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 2000 } },
            },
          },
        },
      },
      permissionHint: 'readonly',
      spec: { isReadOnly: true, isConcurrencySafe: false, isDestructive: false, sideEffect: 'session', category: 'task', requiresApproval: false },
      async execute(_toolCallId, args) {
        const disposition = args.disposition;
        if (!['completed', 'partial', 'blocked', 'cancelled', 'budget_paused'].includes(String(disposition))) {
          throw new Error('TURN_COMPLETION_INVALID: disposition is not supported.');
        }
        const refs = Array.isArray(args.evidenceRefs) ? args.evidenceRefs : [];
        const evidenceRefs = refs.filter((ref): ref is { uri: string; hash: string } => (
          !!ref && typeof ref === 'object' && typeof (ref as Record<string, unknown>).uri === 'string'
            && typeof (ref as Record<string, unknown>).hash === 'string'
        ));
        if (turnHandle) {
          const rawResult = args.result as TurnCompletionDeclaration['result'] | undefined;
          if (rawResult && Object.values(rawResult.outputs ?? {}).some((value) => typeof value !== 'string')) {
            throw new Error('TURN_COMPLETION_INVALID: result.outputs values must be strings.');
          }
          const declaration = { disposition: disposition as TurnCompletionDeclaration['disposition'], evidenceRefs, ...(rawResult ? { result: rawResult } : {}) };
          await validate?.(declaration);
          turnHandle.completionDeclaration = declaration;
        }
        return { content: [{ type: 'text', text: `Turn completion recorded: ${String(disposition)}.` }] };
      },
    };
  }

  createRdcContextTool(sessionId?: string | null, projectId?: string | null): AgentTool<Record<string, never>, { available: boolean }> {
    return {
      name: 'rdc_context',
      label: 'RDC Context',
      description: 'Read the owning RDC runtime context, main-verified captureContentSha256, current session artifact capacity, and frozen CLI deadline controls. Capacity is a point-in-time snapshot, not a future reservation. CLI timeout covers one invocation, not the whole operation or guaranteed native exit. Missing controls remain explicitly unavailable.',
      pollable: true,
      parameters: {
        type: 'object',
        properties: {},
      },
      permissionHint: 'readonly',
      spec: { isReadOnly: true, isConcurrencySafe: false, isDestructive: false, sideEffect: 'session', category: 'system', requiresApproval: false },
      async execute(_toolCallId, _args, _signal, _onUpdate, executionContext) {
        const lease = assertRdcContextLeaseOwnership({
          sessionId,
          projectId,
        });
        const runtimeContext = lease?.runtimeContext ?? null;
        if (!runtimeContext || !lease) {
          const retainedLease = sessionId ? getRdcContextLease(sessionId) : null;
          const requiresRecovery = !!retainedLease && retainedLease.ownerSessionId === sessionId
            && retainedLease.ownerProjectId === projectId && !!retainedLease.quarantineReason;
          return {
            content: [{
              type: 'text',
              text: requiresRecovery
                ? 'The capture is open, but replay requires controlled recovery. Close it in Capture, confirm that close succeeds, then reopen before further RDC operations. Preserve the confirmed goal and earlier evidence.'
                : sessionId
                ? 'The capture is not open in this session. Ask the user to select the capture and click Open in the Capture section. Preserve the confirmed goal; do not describe internal leases or diagnose a rendering cause.'
                : 'RDC runtime context requires an owning sessionId (no global fallback).',
            }],
            details: { available: false, requiresRecovery },
          };
        }
        const ownerSessionId = lease?.delegatedFrom ?? sessionId;
        const scope = ownerSessionId && projectId ? { sessionId: ownerSessionId, projectId } : null;
        const opened = scope ? rdcSessionService.snapshotOpenedCaptureForSession(scope) : null;
        const binding = scope ? rdcSessionService.listBindingsForProject(scope.projectId).find(item =>
          item.scope.sessionId === scope.sessionId && item.scope.projectId === scope.projectId
          && item.contextId === runtimeContext.contextId) : undefined;
        const captureContentSha256 = opened?.status === 'open' && binding && ['ready', 'applying'].includes(binding.phase)
          && runtimeContext.captureFileId && runtimeContext.replaySessionId
          && opened.contextId === runtimeContext.contextId && opened.captureFileId === runtimeContext.captureFileId
          && opened.replaySessionId === runtimeContext.replaySessionId && /^[a-f0-9]{64}$/.test(binding?.captureHash ?? '')
          ? binding!.captureHash : null;
        return {
          content: [{ type: 'text', text: JSON.stringify({ ...runtimeContext, captureContentSha256,
            hostControls: ownerSessionId && projectId ? readRdcHostControls({ sessionId: ownerSessionId,
              projectId, contextId: runtimeContext.contextId, leaseVersion: lease.version }, executionContext) : null,
          }, null, 2) }],
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

  createPlanArtifactTool(sessionId?: string | null): AgentTool<
    { title?: string; summary?: string[]; content?: string; requiredTaskIds?: string[]; taskRevisions?: unknown[] },
    { sessionId: string | null }
  > {
    return {
      name: 'plan_artifact',
      label: 'Submit Plan for Review',
      description: 'Submit the current session plan for in-loop human review. Title, a 1-4 item summary, and Markdown content are required. The runtime writes session://plans/plan.md and pauses until the user approves or rejects. Approval freezes the plan; the user clicks a declared continue action to proceed.',
      parameters: {
        type: 'object',
        required: ['title', 'summary', 'content'],
        properties: {
          title: { type: 'string', description: 'Short plan title shown on the review card.' },
          summary: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 4,
            description: 'One to four concise summary lines. Do not put the full plan here.',
          },
          content: { type: 'string', description: 'Markdown plan body. Use ## headings for sections.' },
          requiredTaskIds: { type: 'array', maxItems: 128, items: { type: 'string', minLength: 1 }, description: 'Existing owning-session Tasks required by this plan; canonical owner planner only, not delegated Capsules. Main freezes goals, output keys, dependencies and executionRequirements into the reviewed hash. Bind mandatory direct, isolated-analysis and independent-review work. Later in-scope detail Tasks remain possible; do not place task contracts in Markdown or metadata.' },
          taskRevisions: { type: 'array', maxItems: 128, description: 'Explicit proposed changes to existing required Tasks, installed only after user approval. Preserve history, consumed budgets and deadlines; stop/join active work first. Completed Tasks cannot reopen.', items: {
            type: 'object', additionalProperties: false, required: ['taskId', 'expectedRevision'], properties: {
              taskId: { type: 'string' }, expectedRevision: { type: 'integer', minimum: 1 },
              subject: { type: 'string', minLength: 1 }, description: { type: 'string' },
              completionRequirements: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 64 },
              executionRequirements: TASK_EXECUTION_REQUIREMENTS_JSON_SCHEMA,
            },
          } },
        },
      },
      permissionHint: 'session_mutation',
      spec: { isReadOnly: false, isConcurrencySafe: false, isDestructive: false, sideEffect: 'session', category: 'comm', requiresApproval: false },
      async execute() {
        return {
          content: [{
            type: 'text',
            text: 'plan_artifact must be executed by the conversation plan review bridge.',
          }],
          isError: true,
          details: { sessionId: sessionId ?? null },
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

  createSkillsCatalogTool(agentId: AgentRole): AgentTool<
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

  createSkillReadTool(agentId: AgentRole): AgentTool<
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
            throw new Error('SKILL_REFERENCE_PATH_DENIED: use an exact relative path under this Skill references/ directory.');
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
          throw new Error('SKILL_REFERENCE_REQUIRED: offset/limit require a reference path.');
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
      this.createSkillsCatalogTool(agentId),
      this.createSkillReadTool(agentId),
      this.createMcpCatalogTool(),
      ...createKnowledgeTools(sessionId),
      ...createInvestigationTools(sessionId),
      ...this.deps.createSubagentTools(agentId, sessionId, turnHandle),
      ...(this.deps.createBackgroundTools?.(agentId, sessionId, turnHandle) ?? []),
    ];
  }

  resolveRuntimeTools(
    agentId: AgentRole,
    toolAllowlist: string[],
    sessionId?: string | null,
    turnHandle?: TurnHandle | null,
    projectId?: string | null,
    projectRootPath?: string | null,
    mcpPoolKey?: string | null,
    options?: { excludeRdcLeaseTools?: boolean; excludeSubagent?: boolean },
  ): ResolvedRuntimeTools {
    const excludeRdcLeaseTools = options?.excludeRdcLeaseTools === true
      || turnHandle?.runtimePlan?.excludeRdcLeaseTools === true;
    const excludeSubagent = options?.excludeSubagent === true
      || turnHandle?.runtimePlan?.excludeSubagent === true;
    const availableTools = new Map<string, AgentTool>();
    for (const tool of getPrimitiveTools()) {
      availableTools.set(normalizeToolName(tool.name), tool);
    }
    for (const tool of this.createTaskRuntimeTools(sessionId, turnHandle)) {
      availableTools.set(normalizeToolName(tool.name), tool);
    }
    const turnCompletionTool = this.createTurnCompletionTool(turnHandle, async declaration => {
      if (turnHandle) {
        const unfinished = await listUnfinishedDirectTasks({
          sessionId,
          turnId: turnHandle.turnId,
          generation: turnHandle.generation,
        });
        if (unfinished.length > 0) {
          throw new Error(`TASK_COMPLETION_DENIED: Settle direct Tasks before turn_complete with task_update(status=completed or blocked): ${unfinished.map((item) => item.taskId).join(', ')}.`);
        }
      }
      const scope = sessionId ? getDelegatedTaskScope(sessionId) : null;
      if (sessionId && !scope && declaration.disposition === 'completed') {
        await new TaskRegistry(createSessionTaskStore(sessionId)).assertApprovedTasksCompleted();
      }
      if (scope && declaration.disposition === 'completed') {
        const task = await new TaskRegistry(createSessionTaskStore(scope.ownerSessionId)).getTask(scope.rootTaskId);
        if (!task) throw new Error('TASK_NOT_FOUND: cannot declare completion without the owning Task.');
        const missing = task.completionRequirements.filter(key => !declaration.result?.outputs[key]);
        if (missing.length) throw new Error(`TURN_COMPLETION_INVALID: result.outputs must contain these exact Task keys: ${JSON.stringify(missing)}. Correct the structured result before completing.`);
      }
      enforceMissionTurnCompletion({ profileId: agentId, sessionId, disposition: declaration.disposition, evidenceRefs: declaration.evidenceRefs, finalAnswerText: JSON.stringify(declaration) });
    });
    availableTools.set(turnCompletionTool.name, turnCompletionTool);
    if (!excludeRdcLeaseTools) {
      const rdcContextTool = this.createRdcContextTool(sessionId, projectId ?? turnHandle?.eventSink?.projectId ?? null);
      availableTools.set(rdcContextTool.name, rdcContextTool);
      const rdcProbeTool = createRdcProbeTool(
        sessionId,
        projectId ?? turnHandle?.eventSink?.projectId ?? null,
      );
      availableTools.set(rdcProbeTool.name, rdcProbeTool as unknown as AgentTool);
    }
    for (const tool of this.createWorkbenchTools(agentId, sessionId, turnHandle)) {
      if (excludeSubagent && normalizeToolName(tool.name) === 'subagent') continue;
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
        && this.isAllowedForRuntime(agentId, tool.name, toolAllowlist, excludeRdcLeaseTools),
      ),
    );
    availableTools.set(normalizeToolName(toolSearchTool.name), toolSearchTool);

    const definitions: ToolDefinition[] = [];
    const toolMap = new Map<string, AgentTool>();
    for (const tool of availableTools.values()) {
      if (!this.matchesToolAllowlist(tool.name, toolAllowlist)) continue;
      if (!this.isAllowedForRuntime(agentId, tool.name, toolAllowlist, excludeRdcLeaseTools)) continue;
      const normalized = normalizeToolName(tool.name);
      if (!toolMap.has(normalized)) {
        toolMap.set(normalized, tool);
        definitions.push(toolToDefinition(tool));
      }
    }
    return { definitions, toolMap };
  }
}
