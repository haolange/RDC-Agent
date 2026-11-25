import { AppError } from '@shared/errors/appError';
/**
 * RuntimeToolAssembly — resolveRuntimeTools: the runtime allowlist, the workbench tool set and
 * the turn's tool map. Tool declarations live in TurnControlTools, WorkbenchTools and the tool modules.
 */

import { TASK_EXECUTION_REQUIREMENTS_JSON_SCHEMA } from '@shared/types/taskExecution';
import { isRdcLeaseToolName } from '@shared/constants/rdcLeaseTools';
import { toolToDefinition } from '../agent/AgentTool';
import { createToolSearchTool, getPrimitiveTools } from '../tools';
import { MemoryStore } from '../memory/MemoryStore';
import { TaskRegistry, createSessionTaskStore, getDelegatedTaskScope } from '../tasks';
import { createOutputRegistrationTool } from '../../reports/OutputRegistrationTool';
import { createKnowledgeTools } from '../../knowledge/KnowledgeTools';
import { createInvestigationTools } from '../../investigation/InvestigationTools';
import {
  expandCanonicalToolToken,
  isToolAllowedByFrozenAllowlist,
  normalizeToolName,
} from './RuntimeToolPolicy';
import { createRdcProbeTool } from './RdcProbeTool';
import { createTaskRuntimeTools as assembleTaskRuntimeTools } from './TaskRuntimeTools';
import { createRuntimeContextTool, createTurnCompletionTool } from './TurnControlTools';
import {
  createAskUserTool,
  createMcpCatalogTool,
  createMemoryDeleteTool,
  createMemoryReadTool,
  createMemorySearchTool,
  createMemoryWriteTool,
  createSkillReadTool,
  createSkillsCatalogTool,
} from './WorkbenchTools';
import { listActiveDelegations, listUnfinishedDirectTasks } from './DirectTaskTurnLifecycle';
import { completionBudgetEvidence } from './CompletionBudgetEvidence';
import type { TurnHandle } from './TurnCoordinator';
import type { McpConnectionCoordinator } from './McpConnectionCoordinator';
import type { ResolvedRuntimeTools } from './orchestratorTypes';
import type { ToolDefinition } from '../core/types';
import type { AgentTool } from '../agent/AgentTool';
import type { MCPServerStatusSummary } from '@shared/types/mcp';
import type { AgentRole } from '@shared/types/agent';

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

  createPlanArtifactTool(sessionId?: string | null): AgentTool<
    { title?: string; summary?: string[]; content?: string; requiredTaskIds?: string[]; taskRevisions?: unknown[]; captureScope?: unknown },
    { sessionId: string | null }
  > {
    return {
      name: 'plan_artifact',
      label: 'Submit Plan for Review',
      description: 'Submit the current session plan for in-loop human review. Title, a 1-4 item summary, and Markdown content are required. Settle current direct Tasks with their actual results first; approval ends the planning turn. Keep post-approval work pending rather than starting it during planning. The runtime writes session://plans/plan.md and pauses until the user approves or rejects. Approval freezes the plan; the user clicks a declared continue action to proceed.',
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
          requiredTaskIds: { type: 'array', maxItems: 128, items: { type: 'string', minLength: 1 }, description: 'Existing owning-session Tasks required by this plan; canonical owner planner only, not delegated Capsules. If this planning turn created unfinished Tasks, explicitly supply the required IDs or [] when none are required. Main freezes goals, output keys, dependencies and executionRequirements into the reviewed hash. Bind mandatory direct, isolated-analysis and independent-review work. Later in-scope detail Tasks remain possible; do not place task contracts in Markdown or metadata.' },
          captureScope: { type: 'object', additionalProperties: false, required: ['inputIds', 'deviceId', 'comparisonGoal'], description: 'For any planned live RDC work, including a single current capture and its recovery or restoration, list the intended registered project input IDs, the already selected replay device ID, and the investigation goal. Read these IDs from runtime_context.capturePlanning. The host verifies and freezes their content hashes for user review. Offline-only plans may omit this field.', properties: {
            inputIds: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'string', minLength: 1 } },
            deviceId: { type: 'string', minLength: 1 }, comparisonGoal: { type: 'string', minLength: 1, maxLength: 4000 },
          } },
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
      spec: { isReadOnly: false, concurrency: 'exclusive', isDestructive: false, sideEffect: 'session', category: 'comm', requiresApproval: false,
        interaction: 'plan-review' },
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

  createWorkbenchTools(agentId: AgentRole, sessionId?: string | null, turnHandle?: TurnHandle | null): AgentTool[] {
    return [
      createAskUserTool(agentId),
      createMemorySearchTool(this.deps.getMemoryStore, sessionId),
      createMemoryReadTool(this.deps.getMemoryStore, sessionId),
      createMemoryWriteTool(this.deps.getMemoryStore),
      createMemoryDeleteTool(this.deps.getMemoryStore),
      this.createPlanArtifactTool(sessionId),
      createOutputRegistrationTool({
        sessionId,
        runId: turnHandle?.runId,
        projectRootPath: turnHandle?.eventSink?.projectRootPath,
      }) as unknown as AgentTool,
      createSkillsCatalogTool(agentId),
      createSkillReadTool(agentId),
      createMcpCatalogTool(this.deps.getMcpServerStatusSummary),
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
    const turnCompletionTool = createTurnCompletionTool(turnHandle, async declaration => {
      if (turnHandle) {
        const unfinished = await listUnfinishedDirectTasks({
          sessionId,
          turnId: turnHandle.turnId,
          generation: turnHandle.generation,
        });
        if (unfinished.length > 0) {
          throw new AppError('TASK_COMPLETION_DENIED', `Settle direct Tasks before turn_complete with task_update(status=completed or blocked): ${unfinished.map((item) => item.taskId).join(', ')}. If useful work remains executable, keep its Task in progress and continue; mark it blocked only for a concrete reason that prevents further work, not merely because the result is unknown or unfinished.`);
        }
      }
      const scope = sessionId ? getDelegatedTaskScope(sessionId) : null;
      if (sessionId && !scope && turnHandle?.requiresApprovedGoalClosure && declaration.disposition === 'completed') {
        await new TaskRegistry(createSessionTaskStore(sessionId)).assertApprovedTasksCompleted();
      }
      if (turnHandle?.requiresApprovedGoalClosure && ['partial', 'blocked', 'budget_paused'].includes(declaration.disposition)
        && (!declaration.result?.summary?.trim() || !declaration.result.unresolved.some(item => item.blocker !== 'not_required'))) {
        throw new AppError('TURN_COMPLETION_INVALID', 'partial, blocked and budget-paused goals require a summary and at least one unresolved item whose blocker prevents the work now (capability, permission, budget, strategy or external). If nothing blocks a remaining item, continue it instead of stopping.');
      }
      if (turnHandle?.requiresApprovedGoalClosure && declaration.disposition === 'budget_paused' && !completionBudgetEvidence(turnHandle)) {
        throw new AppError('TURN_COMPLETION_INVALID', 'no current root budget limit has been observed.');
      }
      if (sessionId && turnHandle?.requiresApprovedGoalClosure && declaration.disposition === 'completed') {
        const active = await listActiveDelegations(sessionId);
        if (active.length) throw new AppError('TASK_COMPLETION_DENIED', `Join active delegated executions before completing the approved goal: ${active.map(item => item.id).join(', ')}.`);
      }
      if (scope && declaration.disposition === 'completed') {
        const task = await new TaskRegistry(createSessionTaskStore(scope.ownerSessionId)).getTask(scope.rootTaskId);
        if (!task) throw new AppError('TASK_NOT_FOUND', 'cannot declare completion without the owning Task.');
        const missing = task.completionRequirements.filter(key => !declaration.result?.outputs[key]);
        if (missing.length) throw new AppError('TURN_COMPLETION_INVALID', `result.outputs must contain these exact Task keys: ${JSON.stringify(missing)}. Correct the structured result before completing.`);
      }
      await turnHandle?.validateCompletionReadiness?.(declaration);
    });
    availableTools.set(turnCompletionTool.name, turnCompletionTool);
    const runtimeContextTool = createRuntimeContextTool(sessionId, projectId ?? turnHandle?.eventSink?.projectId ?? null);
    availableTools.set(runtimeContextTool.name, runtimeContextTool);
    if (!excludeRdcLeaseTools) {
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
