import { enforceMissionTurnCompletion } from '../../investigation/missionCompletionContract';
import { validateInvestigationHandoff } from '../../investigation/investigationHandoffValidation';
import { HANDOFF_CONTRACT_JSON_SCHEMA } from '@shared/types/handoffContract';
import { validateHandoffArtifacts } from '../../sessions/handoffArtifacts';
/**
 * RuntimeToolAssembly — resolveRuntimeTools / workbench / MCP catalog tools.
 */

import type { AgentRole } from '@shared/types/agent';
import type { MCPServerStatusSummary } from '@shared/types/mcp';
import type { ConversationAskUserQuestion } from '@shared/types/conversation';
import { normalizeAskUserQuestions } from '@shared/utils/askUser';
import type { AgentTool } from '../../agent-runtime/agent/AgentTool';
import { toolToDefinition } from '../../agent-runtime/agent/AgentTool';
import type { ToolDefinition } from '../../agent-runtime/core/types';
import { createToolSearchTool, getPrimitiveTools } from '../../agent-runtime/tools';
import { HANDOFF_ERROR } from '@shared/types/profileHandoff';
import { assertMissionExecutePlanGate, handoffController } from '../../agent-runtime/agent/HandoffController';
import { isHandoffDeclaredModelValid } from '../../sessions/profileHandoffModel';
import { settingsService } from '../../settings/SettingsService';
import { MemoryStore } from '../../agent-runtime/memory/MemoryStore';
import { TaskRegistry, createSessionTaskStore, getDelegatedTaskScope, type TaskCompletionResult, type TaskExecutionRecord } from '../../agent-runtime/tasks';
import { assertRdxContextLeaseOwnership } from '../../sessions/RdxRuntimeContextRegistry';
import { storageAdapter } from '../../sessions/StorageAdapter';
import { dispatchRuntimeHooks } from '../../hooks/runtimeHookDispatch';
import { createOutputRegistrationTool } from '../../reports/OutputRegistrationTool';
import { createKnowledgeTools } from '../../knowledge/KnowledgeTools';
import { createInvestigationTools } from '../../investigation/InvestigationTools';
import { agentRuntimeConfigService } from '../../settings/AgentRuntimeConfigService';
import {
  expandCanonicalToolToken,
  isToolAllowedByFrozenAllowlist,
  normalizeToolName,
} from './DebuggerRuntimePolicy';
import { isRdxLeaseToolName } from '@shared/constants/rdxLeaseTools';
import { createRdxProbeTool } from './RdxProbeTool';
import type { TurnCompletionDeclaration, TurnHandle } from './TurnCoordinator';
import type { McpConnectionCoordinator } from './McpConnectionCoordinator';
import type { ResolvedRuntimeTools } from './orchestratorTypes';
import { createTaskRuntimeTools as assembleTaskRuntimeTools } from './TaskRuntimeTools';
import { registerPreparedHandoffExecutionOwner } from './DirectTaskTurnLifecycle';
import { bindTaskRootBudget } from './TaskRootBudget';

export interface RuntimeToolAssemblyDeps {
  mcp: McpConnectionCoordinator;
  getActiveTurn: (sessionId?: string | null) => TurnHandle | null;
  getMemoryStore: (scope: 'user' | 'project', projectRootPath?: string | null) => MemoryStore;
  createSubagentTools: (parentAgentId: AgentRole, sessionId?: string | null, turnHandle?: TurnHandle | null) => AgentTool[];
  createBackgroundTools?: (parentAgentId: AgentRole, sessionId?: string | null, turnHandle?: TurnHandle | null) => AgentTool[];
  getMcpServerStatusSummary: (projectRootPath?: string | null, query?: string) => MCPServerStatusSummary[];
}

function readHandoffTaskResult(value: unknown): TaskCompletionResult {
  if (!value || typeof value !== 'object') throw new Error('HANDOFF_TASK_RESULT_REQUIRED: Task-owned return requires a structured taskResult.');
  const record = value as Record<string, unknown>;
  if (!['completed', 'partial', 'blocked', 'cancelled'].includes(String(record.disposition))
    || typeof record.summary !== 'string' || !record.summary.trim()
    || !record.outputs || typeof record.outputs !== 'object' || Array.isArray(record.outputs)) {
    throw new Error('HANDOFF_TASK_RESULT_INVALID: disposition, summary, and outputs are required.');
  }
  const outputs: Record<string, string> = {};
  for (const [key, output] of Object.entries(record.outputs as Record<string, unknown>)) {
    if (typeof output !== 'string') throw new Error(`HANDOFF_TASK_RESULT_INVALID: output ${key} must be a string reference.`);
    outputs[key] = output;
  }
  return { disposition: record.disposition as TaskCompletionResult['disposition'], summary: record.summary, outputs };
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
    excludeRdxLeaseTools?: boolean,
  ): boolean {
    if (excludeRdxLeaseTools && isRdxLeaseToolName(toolName)) {
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
                ? 'The capture is not open in this session. Ask the user to select the capture and click Open in the Capture section. Preserve the confirmed goal; do not describe internal leases or diagnose a rendering cause.'
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

  createAgentHandoffTool(
    agentId: AgentRole,
    sessionId?: string | null,
    turnHandle?: TurnHandle | null,
  ): AgentTool<
    { agent?: string; label?: string; prompt?: string; contract?: unknown; taskId?: string; taskResult?: TaskCompletionResult },
    { fromAgentId: AgentRole; toAgentId: string; label: string; prompt: string; valid: boolean; executionId?: string; generation?: number }
  > {
    const getActiveTurn = this.deps.getActiveTurn;
    const capturedTurn = turnHandle ?? getActiveTurn(sessionId);
    return {
      name: 'agent_handoff',
      label: 'Agent Handoff',
      description: 'Request a handoff to another agent profile. The runtime validates the target against the current profile handoffs and prepares the receiving prompt. The actual profile switch is applied by the orchestrator after this turn.',
      parameters: {
        type: 'object',
        required: ['agent', 'prompt', 'contract'],
        properties: {
          contract: HANDOFF_CONTRACT_JSON_SCHEMA,
          agent: { type: 'string', description: 'Declared target agent profile id.' },
          label: { type: 'string', description: 'Short handoff label. Defaults to the declared handoff label.' },
          prompt: { type: 'string', description: 'Implementation or specialist prompt for the receiving agent. Required summary of the objective, evidence and current gaps.' },
          taskId: { type: 'string', description: 'Optional logical Task owned by an execute handoff.' },
          taskResult: { type: 'object', description: 'Structured result required when returning a Task-owned handoff.' },
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
        let contract;
        try {
          contract = validateHandoffArtifacts(resolvedSessionId, args.contract);
          const planGate = assertMissionExecutePlanGate({
            sourceAgentId: agentId,
            target,
            intent: contract.intent,
            planHash: contract.intent === 'execute' ? contract.plan.hash : undefined,
            planUri: contract.intent === 'execute' ? contract.plan.uri : undefined,
            approved: turn?.approvedPlan ?? null,
          });
          if (!planGate.valid) {
            return {
              content: [{
                type: 'text',
                text: `${planGate.code ?? HANDOFF_ERROR.PLAN_NOT_APPROVED}: ${planGate.reason ?? 'Mission execute requires an approved frozen plan.'}`,
              }],
              isError: true,
              details: { fromAgentId: agentId, toAgentId: target, label, prompt, valid: false, code: planGate.code },
            };
          }
          validateInvestigationHandoff({ sessionId: resolvedSessionId, sourceAgentId: agentId, targetAgentId: target, contract, taskBinding: turn?.runtimePlan?.taskBinding });
        } catch (error) {
          return { content: [{ type: 'text', text: String(error) }], isError: true, details: { fromAgentId: agentId, toAgentId: target, label, prompt, valid: false } };
        }
        const projectRoot = turn?.runtimePlan?.projectRootPath ?? undefined;
        const handoffAllowed = await dispatchRuntimeHooks('agent.before-handoff', {
          agentId,
          sessionId: resolvedSessionId,
          projectRoot,
          payload: {
            fromAgentId: agentId,
            toAgentId: target,
            label,
            prompt,
            depth,
            contract,
          },
        });
        if (!handoffAllowed) {
          return {
            content: [{ type: 'text', text: 'HOOK_DENIED: agent.before-handoff' }],
            isError: true,
            details: { fromAgentId: agentId, toAgentId: target, label, prompt, valid: false },
          };
        }
        const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : '';
        const priorTaskBinding = contract.intent === 'return'
          ? (typeof store.readDocument === 'function' ? (store.readDocument(resolvedSessionId)?.history ?? []) : []).find((entry) => entry.handoffId === contract.executionHandoffId)?.taskExecution
          : undefined;
        if (contract.intent === 'return' && taskId) {
          return { content: [{ type: 'text', text: 'HANDOFF_TASK_INVALID: return uses the frozen execution binding; taskId must be omitted.' }], isError: true, details: { fromAgentId: agentId, toAgentId: target, label, prompt, valid: false } };
        }
        let taskExecution: TaskExecutionRecord | undefined;
        const taskRegistry = new TaskRegistry(createSessionTaskStore(resolvedSessionId));
        if (contract.intent === 'execute' && taskId) {
          const previousExecution = (await taskRegistry.listExecutions(taskId)).at(-1);
          const rootBudgetId = turn?.policyBudget
            ? await bindTaskRootBudget(taskRegistry, resolvedSessionId, turn.policyBudget, previousExecution?.rootBudgetId)
            : undefined;
          taskExecution = await taskRegistry.startExecution(taskId, {
            mode: 'handoff',
            rootBudgetId,
            frozenPlanRef: `handoff:${sourceTurnId}`,
            budget: turn?.policyBudget ? {
              maxToolCalls: turn.policyBudget.maxToolCalls, toolCalls: turn.policyBudget.toolCalls,
              maxSubagents: turn.policyBudget.maxSubagents, subagents: turn.policyBudget.subagents,
              maxChildDepth: turn.policyBudget.maxChildDepth, childDepth: turn.subagentBudget.depth,
              deadlineAt: turn.policyBudget.wallStartedAt + turn.policyBudget.maxWallTimeMs,
            } : undefined,
          });
        }
        const taskReturnResult = priorTaskBinding ? readHandoffTaskResult(args.taskResult) : undefined;
        const prepareInput = {
          contract,
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
          taskExecution: taskExecution ? {
            taskId: taskExecution.taskId,
            executionId: taskExecution.id,
            generation: taskExecution.generation,
            taskRevision: taskExecution.taskRevision,
          } : priorTaskBinding,
          taskResult: taskReturnResult,
        };
        let draftHandoffId: string | null = null;
        try {
          const draft = store.createPreparedDraft(resolvedSessionId, prepareInput);
          draftHandoffId = draft.handoffId;
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
          const afterAllowed = await dispatchRuntimeHooks('agent.after-handoff', {
            agentId,
            sessionId: resolvedSessionId,
            projectRoot,
            payload: { toAgentId: target, handoffId: draft.handoffId, label },
          });
          if (!afterAllowed) {
            throw new Error('HOOK_DENIED: agent.after-handoff');
          }
          const prepared = store.prepare(resolvedSessionId, {
            ...prepareInput,
            handoffId: draft.handoffId,
          });
          if (taskExecution) {
            registerPreparedHandoffExecutionOwner(resolvedSessionId, prepared.handoffId, taskExecution.id);
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
              executionId: taskExecution?.id ?? priorTaskBinding?.executionId,
              generation: taskExecution?.generation ?? priorTaskBinding?.generation,
            },
          };
        } catch (error) {
          if (turn) {
            turn.pendingHandoff = null;
          }
          if (draftHandoffId) {
            store.abandonDraft(resolvedSessionId, draftHandoffId);
            const leaked = store.getActive(resolvedSessionId);
            if (leaked?.handoffId === draftHandoffId) {
              store.cancel(resolvedSessionId, 'superseded');
            }
          }
          let settlementError: unknown;
          if (taskExecution) {
            try { await taskRegistry.settleExecution(taskExecution.id, {
              expectedGeneration: taskExecution.generation,
              status: 'failed',
              result: { disposition: 'blocked', summary: `Handoff preparation failed: ${error instanceof Error ? error.message : String(error)}`, outputs: {} },
            }); } catch (failure) { settlementError = failure; }
          }
          const message = `${error instanceof Error ? error.message : String(error)}${settlementError ? `; TASK_SETTLEMENT_FAILED: ${settlementError instanceof Error ? settlementError.message : String(settlementError)}` : ''}`;
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
    { title?: string; summary?: string[]; content?: string },
    { sessionId: string | null }
  > {
    return {
      name: 'plan_artifact',
      label: 'Submit Plan for Review',
      description: 'Submit the current session plan for in-loop human review. Title, a 1-4 item summary, and Markdown content are required. The runtime writes session://plans/plan.md and pauses until the user approves a declared continue handoff or rejects with feedback.',
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

        const skill = agentRuntimeConfigService.loadSkill(skillKey, context?.projectRootPath ?? undefined, agentId);
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
    options?: { excludeRdxLeaseTools?: boolean },
  ): ResolvedRuntimeTools {
    const excludeRdxLeaseTools = options?.excludeRdxLeaseTools === true
      || turnHandle?.runtimePlan?.excludeRdxLeaseTools === true;
    const availableTools = new Map<string, AgentTool>();
    for (const tool of getPrimitiveTools()) {
      availableTools.set(normalizeToolName(tool.name), tool);
    }
    for (const tool of this.createTaskRuntimeTools(sessionId, turnHandle)) {
      availableTools.set(normalizeToolName(tool.name), tool);
    }
    const turnCompletionTool = this.createTurnCompletionTool(turnHandle, async declaration => {
      const scope = sessionId ? getDelegatedTaskScope(sessionId) : null;
      if (scope && declaration.disposition === 'completed') {
        const task = await new TaskRegistry(createSessionTaskStore(scope.ownerSessionId)).getTask(scope.rootTaskId);
        if (!task) throw new Error('TASK_NOT_FOUND: cannot declare completion without the owning Task.');
        const missing = task.completionRequirements.filter(key => !declaration.result?.outputs[key]);
        if (missing.length) throw new Error(`TURN_COMPLETION_INVALID: result.outputs must contain these exact Task keys: ${JSON.stringify(missing)}. Correct the structured result before completing.`);
      }
      enforceMissionTurnCompletion({ profileId: agentId, sessionId, disposition: declaration.disposition, evidenceRefs: declaration.evidenceRefs, finalAnswerText: JSON.stringify(declaration) });
    });
    availableTools.set(turnCompletionTool.name, turnCompletionTool);
    if (!excludeRdxLeaseTools) {
      const rdxContextTool = this.createRdxContextTool(sessionId, projectId ?? turnHandle?.eventSink?.projectId ?? null);
      availableTools.set(rdxContextTool.name, rdxContextTool);
      const rdxProbeTool = createRdxProbeTool(
        sessionId,
        projectId ?? turnHandle?.eventSink?.projectId ?? null,
      );
      availableTools.set(rdxProbeTool.name, rdxProbeTool as unknown as AgentTool);
    }
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
        && this.isAllowedForRuntime(agentId, tool.name, toolAllowlist, excludeRdxLeaseTools),
      ),
    );
    availableTools.set(normalizeToolName(toolSearchTool.name), toolSearchTool);

    const definitions: ToolDefinition[] = [];
    const toolMap = new Map<string, AgentTool>();
    for (const tool of availableTools.values()) {
      if (!this.matchesToolAllowlist(tool.name, toolAllowlist)) continue;
      if (!this.isAllowedForRuntime(agentId, tool.name, toolAllowlist, excludeRdxLeaseTools)) continue;
      const normalized = normalizeToolName(tool.name);
      if (!toolMap.has(normalized)) {
        toolMap.set(normalized, tool);
        definitions.push(toolToDefinition(tool));
      }
    }
    return { definitions, toolMap };
  }
}
