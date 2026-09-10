import type { AgentTool } from '../../agent-runtime/agent/AgentTool';
import { createTaskTools, TaskRegistry, MemoryTaskStore, createSessionTaskStore, projectTaskItems, getDelegatedTaskScope } from '../../agent-runtime/tasks';
import { traceProjectionRefreshService } from '../../agent-trace/TraceProjectionRefreshService';
import { generateEventId, nowMs } from '@shared/utils/id';
import type { TurnHandle } from './TurnCoordinator';
import { getConsumedHandoffTaskBinding } from './DirectTaskTurnLifecycle';
import { notifyBackgroundExecutionMessage } from './BackgroundSubagentService';
import { sessionArtifactResolver } from '../../sessions/SessionArtifactResolver';
import { bindTaskRootBudget } from './TaskRootBudget';

export function createTaskRuntimeTools(input: {
  sessionId?: string | null;
  turnHandle?: TurnHandle | null;
  getActiveTurn: (sessionId?: string | null) => TurnHandle | null;
}): AgentTool[] {
  const resolvedSessionId = input.sessionId ?? input.turnHandle?.eventSink?.sessionId ?? null;
  const delegatedScope = resolvedSessionId ? getDelegatedTaskScope(resolvedSessionId) : null;
  const isSubagent = resolvedSessionId?.includes('::subagent::') ?? false;
  const store = delegatedScope ? createSessionTaskStore(delegatedScope.ownerSessionId)
    : isSubagent || !resolvedSessionId ? new MemoryTaskStore() : createSessionTaskStore(resolvedSessionId);
  const ownerSessionId = delegatedScope?.ownerSessionId ?? resolvedSessionId;
  const registry = new TaskRegistry(store, {
    validateResultRef: async (_task, result) => {
      if (!result.resultRef) return true;
      if (!ownerSessionId || !result.resultHash) return false;
      try {
        const verified = sessionArtifactResolver.read(ownerSessionId, result.resultRef, { expectedHash: result.resultHash, limit: 1 });
        return verified.hash === result.resultHash;
      } catch {
        return false;
      }
    },
  });
  registry.onTaskChange = ({ type, task }) => {
    if (resolvedSessionId && !isSubagent) traceProjectionRefreshService.schedule(resolvedSessionId);
    const sink = input.turnHandle?.eventSink ?? input.getActiveTurn(resolvedSessionId)?.eventSink;
    if (!sink?.onEvent || (input.turnHandle && !input.turnHandle.isLive(input.turnHandle.generation))) return;
    void registry.listTasks().then((tasks) => {
      if (input.turnHandle && !input.turnHandle.isLive(input.turnHandle.generation)) return;
      sink.onEvent?.({
        id: generateEventId('agent-event'),
        type: type === 'created' ? 'task.created' : 'task.updated',
        timestamp: nowMs(),
        sessionId: sink.sessionId ?? null,
        agentId: sink.agentId,
        payload: { taskId: task.id, title: task.subject, status: task.status, statusReason: task.statusReason, snapshot: projectTaskItems(tasks) },
      });
    });
  };
  const recovery = registry.reconcileInterruptedExecutions();
  const tools = createTaskTools(registry, {
    scopeRootTaskId: delegatedScope?.rootTaskId,
    requestCurrentTurnStop: (taskId) => {
      const turn = input.turnHandle ?? input.getActiveTurn(resolvedSessionId);
      if (!resolvedSessionId || !turn) return false;
      const binding = getConsumedHandoffTaskBinding(resolvedSessionId, turn.turnId);
      if (binding?.taskId !== taskId) return false;
      void turn.abortAndJoin({ reason: 'user_stop' });
      return true;
    },
    startOptions: async () => {
      const turn = input.turnHandle ?? input.getActiveTurn(resolvedSessionId);
      const scopedExecutions = await registry.listExecutions();
      const priorRootBudgetId = delegatedScope?.executionId
        ? (await registry.getExecution(delegatedScope.executionId))?.rootBudgetId
        : scopedExecutions.filter((execution) => execution.mode === 'direct').at(-1)?.rootBudgetId;
      const rootBudgetId = turn?.policyBudget && ownerSessionId
        ? await bindTaskRootBudget(registry, ownerSessionId, turn.policyBudget, priorRootBudgetId)
        : undefined;
      return {
        parentExecutionId: delegatedScope?.executionId,
        rootBudgetId,
        frozenPlanRef: turn?.turnId ? `turn:${turn.turnId}:generation:${turn.generation}` : undefined,
        budget: turn?.policyBudget ? {
          maxToolCalls: turn.policyBudget.maxToolCalls,
          toolCalls: turn.policyBudget.toolCalls,
          maxSubagents: turn.policyBudget.maxSubagents,
          subagents: turn.policyBudget.subagents,
          maxChildDepth: turn.policyBudget.maxChildDepth,
          childDepth: turn.subagentBudget.depth,
          deadlineAt: turn.policyBudget.wallStartedAt + turn.policyBudget.maxWallTimeMs,
        } : undefined,
      };
    },
  }).map((tool) => {
    const execute = tool.execute.bind(tool);
    return { ...tool, execute: async (...args: Parameters<typeof execute>) => { await recovery; return execute(...args); } };
  });
  if (delegatedScope?.executionId && delegatedScope.generation) {
    tools.push({
      name: 'subagent_report',
      label: 'Report Subagent Progress',
      description: 'Report meaningful progress, a blocker, or a decision request to the owning Task execution.',
      parameters: { type: 'object', required: ['kind', 'body'], properties: { kind: { type: 'string', enum: ['progress', 'blocked', 'decision_required'] }, body: { type: 'string', maxLength: 8000 } } },
      permissionHint: 'readonly',
      spec: { isReadOnly: false, isConcurrencySafe: true, orchestration: true, isDestructive: false, sideEffect: 'session', category: 'task', requiresApproval: false },
      execute: async (_id, args) => {
        const kind = String(args.kind ?? '');
        const body = String(args.body ?? '').trim();
        if (!['progress', 'blocked', 'decision_required'].includes(kind) || !body || body.length > 8_000) throw new Error('SUBAGENT_REPORT_INVALID');
        const message = await registry.appendExecutionMessage(delegatedScope.executionId!, { expectedGeneration: delegatedScope.generation!, kind: kind as 'progress' | 'blocked' | 'decision_required', direction: 'to_parent', body });
        notifyBackgroundExecutionMessage(delegatedScope.executionId!, kind as 'progress' | 'blocked' | 'decision_required');
        return { content: [{ type: 'text', text: `Report queued: ${message.id}` }], details: { messageId: message.id, sequence: message.sequence } };
      },
    });
  }
  return tools;
}
