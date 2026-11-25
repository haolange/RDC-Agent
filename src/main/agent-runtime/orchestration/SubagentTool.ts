import { createHash } from 'node:crypto';
import { generateEventId } from '@shared/utils/id';
import { DELEGATION_CAPSULE_JSON_SCHEMA, parseDelegationCapsule, type DelegationCapsule } from '@shared/types/delegationCapsule';
import { AppError } from '@shared/errors/appError';
import { delegationCapsuleArtifactRefs } from '../prompt/DelegationCapsuleCompiler';
import { TaskRegistry, createSessionTaskStore, registerTaskExecutionCancellationOwner, type TaskExecutionRecord, getDelegatedTaskScope } from '../tasks';
import { normalizeSubagentResult, persistSubagentResult, projectSubagentResult } from './SubagentResultEnvelope';
import { bindTaskRootBudget } from './TaskRootBudget';
import { registerPolicyBudgetObserver } from './DelegationBudget';
import type { TurnHandle } from './TurnCoordinator';
import type { ActiveTurnLookup } from './orchestratorTypes';
import type { BackgroundSubagentStart } from './BackgroundSubagentService';
import type { AgentTool } from '../agent/AgentTool';
import type { AgentRole } from '@shared/types/agent';
import type { SubagentRunner } from './SubagentRunner';

/**
 * SubagentTool — the `subagent` tool: validates a Delegation Capsule, enforces the frozen delegate
 * set, Task scope and budgets, and dispatches the child in wait or background mode.
 */

/** What the subagent tool needs from its runner. */
export interface SubagentToolHost {
  readonly activeTurns: ActiveTurnLookup;
  runSubagent: SubagentRunner['runSubagent'];
  startBackground?: (input: BackgroundSubagentStart) => Promise<TaskExecutionRecord>;
}

export function createSubagentTools(host: SubagentToolHost, parentAgentId: AgentRole, sessionId?: string | null, turnHandle?: TurnHandle | null): AgentTool[] {
  const { activeTurns, startBackground } = host;
  const capturedTurn = turnHandle ?? activeTurns.getActiveTurn(sessionId);
  const runSubagentTool: AgentTool<
    Record<string, unknown>,
    { subagentId: string; profile: string; status: string; executionId?: string; generation?: number }
  > = {
    name: 'subagent',
    label: 'Subagent',
    description: 'Delegate a structured Delegation Capsule to an isolated sub-agent. Include the goal, scope, evidence, challenges, required methods, output and stopping conditions. Set profile to the required Agent ID: naming an Agent in task text does not select it, and omitting profile selects the caller. A Task with a required profile must use that exact profile. Grant the exact session:// references the child must read; an ID is not a grant. mode=wait waits; mode=background requires taskId. Capability requests do not grant authority. The selected Agent supplies its own model and reasoning configuration.',
    parameters: {
      ...DELEGATION_CAPSULE_JSON_SCHEMA,
      properties: {
        ...DELEGATION_CAPSULE_JSON_SCHEMA.properties,
        taskId: { type: 'string', description: 'Optional logical Task to own this execution. For the same Task across delegations or evidence follow-up, pass its existing taskId each time; repeating a role or goal does not bind executions. In either wait or background mode, leave it unclaimed: do not start a direct execution with task_update(in_progress) first. Settle an existing execution before dispatching another.' },
        parentExecutionId: { type: 'string', description: 'Optional parent Task execution.' },
        mode: { type: 'string', enum: ['wait', 'background'], description: 'Wait for the result or return a durable execution id immediately.' },
      },
    } as unknown as AgentTool['parameters'],
    permissionHint: 'readonly',
    spec: {
      isReadOnly: true,
      concurrency: 'orchestration-parallel',
      dispatchesSubagent: true,
      isDestructive: false,
      sideEffect: 'session',
      category: 'task',
      requiresApproval: false,
    },
    async execute(toolCallId, args, signal) {
      const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : '';
      const parentExecutionId = typeof args.parentExecutionId === 'string' ? args.parentExecutionId.trim() : undefined;
      const mode = args.mode === 'background' ? 'background' : 'wait';
      const { taskId: _taskId, parentExecutionId: _parentExecutionId, mode: _mode, ...capsuleArgs } = args;
      let capsule: DelegationCapsule;
      try {
        capsule = parseDelegationCapsule(capsuleArgs);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: message }],
          isError: true,
          details: { subagentId: '', errorCode: 'DELEGATION_CAPSULE_INVALID', profile: parentAgentId, status: 'failed' },
        };
      }
      const turn = capturedTurn ?? activeTurns.getActiveTurn(sessionId);
      const targetProfile = (capsule.profile?.trim() || parentAgentId) as AgentRole;
      const delegates = turn?.runtimePlan?.profileDelegates ?? [];
      const authorized = delegates.length === 0
        ? targetProfile === parentAgentId
        : targetProfile === parentAgentId || delegates.includes(targetProfile);
      if (!authorized) {
        throw new AppError('SUBAGENT_DELEGATE_DENIED', `${targetProfile} is not in the frozen profileDelegates set.`);
      }
      const parentAccessCeiling = turn?.runtimePlan?.accessCeiling;
      if (!parentAccessCeiling) {
        throw new AppError('SUBAGENT_PARENT_PLAN_REQUIRED', 'delegation needs the delegating turn\'s frozen runtime plan.');
      }
      const resolvedSessionId = sessionId ?? turn?.eventSink?.sessionId ?? null;
      const inheritedScope = resolvedSessionId ? getDelegatedTaskScope(resolvedSessionId) : null;
      const ownerSessionId = inheritedScope?.ownerSessionId ?? resolvedSessionId;
      if (inheritedScope?.executionId && parentExecutionId && parentExecutionId !== inheritedScope.executionId) {
        throw new AppError('TASK_SCOPE_DENIED', 'parentExecutionId must match the delegated execution binding.');
      }
      const effectiveParentExecutionId = inheritedScope?.executionId ?? parentExecutionId;
      if (taskId && inheritedScope) {
        const scopedRegistry = new TaskRegistry(createSessionTaskStore(ownerSessionId!));
        const tasks = await scopedRegistry.listTasks();
        let current = tasks.find((item) => item.id === taskId);
        let allowed = false;
        while (current?.parentTaskId) {
          if (current.parentTaskId === inheritedScope.rootTaskId) { allowed = true; break; }
          current = tasks.find((item) => item.id === current!.parentTaskId);
        }
        if (!allowed) throw new AppError('TASK_SCOPE_DENIED', 'nested delegation must target a descendant of the owning Task.');
      }
      if (mode === 'background') {
        if (!taskId || !ownerSessionId || !startBackground) {
          throw new AppError('BACKGROUND_REQUIRES_TASK', 'background mode requires a session-owned task and background runtime.');
        }
        const execution = await startBackground({
          sessionId: ownerSessionId,
          parentToolCallId: toolCallId,
          originSessionId: resolvedSessionId ?? ownerSessionId,
          taskId,
          parentExecutionId: effectiveParentExecutionId,
          parentAgentId,
          parentAccessCeiling,
          targetProfile,
          capsule,
          projectRootPath: turn?.eventSink?.projectRootPath ?? null,
          projectId: turn?.eventSink?.projectId ?? null,
          policyBudget: turn?.policyBudget,
          subagentBudget: turn?.subagentBudget,
          parentOnEvent: turn?.eventSink?.onEvent,
        });
        return {
          content: [{ type: 'text', text: `Background subagent started: ${execution.id}` }],
          details: { subagentId: execution.id, profile: targetProfile, status: 'running', executionId: execution.id, generation: execution.generation },
        };
      }

      let execution: TaskExecutionRecord | undefined;
      let unregisterOwner: (() => void) | undefined;
      const executionController = new AbortController();
      const forwardAbort = () => executionController.abort();
      const sourceSignal = signal ?? turn?.signal ?? null;
      if (sourceSignal?.aborted) forwardAbort();
      let runPromise: Promise<Awaited<ReturnType<SubagentToolHost['runSubagent']>>> | undefined;
      let releaseExecutionBudgetObserver: (() => void) | undefined;
      if (taskId) {
        if (!ownerSessionId) throw new AppError('TASK_EXECUTION_SESSION_REQUIRED', 'task-owned subagent requires a parent session.');
        const registry = new TaskRegistry(createSessionTaskStore(ownerSessionId));
        const parentExecution = effectiveParentExecutionId
          ? await registry.getExecution(effectiveParentExecutionId)
          : null;
        const previousExecution = (await registry.listExecutions(taskId)).at(-1);
        const rootBudgetId = parentExecution?.rootBudgetId ?? (turn?.policyBudget
          ? await bindTaskRootBudget(registry, ownerSessionId, turn.policyBudget, previousExecution?.rootBudgetId)
          : undefined);
        const startedAt = Date.now();
        execution = await registry.startExecution(taskId, {
          mode: 'subagent',
          dispatch: 'wait',
          requestedProfileId: targetProfile,
          requiredSkillIds: capsule.requiredSkillIds,
          requestedInputArtifactRefs: delegationCapsuleArtifactRefs(capsule),
          parentExecutionId: effectiveParentExecutionId,
          rootBudgetId,
          frozenPlanRef: `capsule:sha256:${createHash('sha256').update(JSON.stringify(capsule)).digest('hex')}`,
          budget: {
            maxToolCalls: capsule.budget.maxToolCalls,
            toolCalls: 0,
            maxSubagents: capsule.budget.maxSubagents,
            subagents: 0,
            maxChildDepth: turn?.policyBudget?.maxChildDepth,
            childDepth: (turn?.subagentBudget.depth ?? 0) + 1,
            deadlineAt: capsule.budget.maxWallTimeMs === undefined && (!turn?.policyBudget || turn.policyBudget.maxWallTimeMs === Number.MAX_SAFE_INTEGER)
              ? undefined
              : Math.min(capsule.budget.maxWallTimeMs === undefined ? Infinity : startedAt + capsule.budget.maxWallTimeMs,
                turn?.policyBudget ? turn.policyBudget.wallStartedAt + turn.policyBudget.maxWallTimeMs : Infinity),
          },
        });
        unregisterOwner = registerTaskExecutionCancellationOwner(execution.id, async () => {
          executionController.abort();
          await runPromise?.catch(() => undefined);
        });
      }
      if (!sourceSignal?.aborted) sourceSignal?.addEventListener('abort', forwardAbort, { once: true });
      let result: Awaited<ReturnType<SubagentToolHost['runSubagent']>>;
      try {
        runPromise = host.runSubagent({
          parentAgentId,
          parentAccessCeiling,
          parentToolCallId: toolCallId,
          targetProfile,
          capsule,
          parentSessionId: sessionId ?? null,
          parentOnEvent: turn?.eventSink?.onEvent,
          projectRootPath: turn?.eventSink?.projectRootPath ?? null,
          projectId: turn?.eventSink?.projectId ?? null,
          parentTurn: turn,
          taskId: taskId || undefined,
          executionId: execution?.id,
          taskExecutionGeneration: execution?.generation,
          restoredPolicyBudget: execution ? {
            toolCalls: execution.budget.toolCalls,
            subagents: execution.budget.subagents,
            childDepth: execution.budget.childDepth,
            reservedSubagentSlots: 0,
            maxToolCalls: execution.budget.maxToolCalls ?? Number.MAX_SAFE_INTEGER,
            maxSubagents: execution.budget.maxSubagents ?? Number.MAX_SAFE_INTEGER,
            maxChildDepth: execution.budget.maxChildDepth ?? Number.MAX_SAFE_INTEGER,
            wallStartedAt: execution.budget.startedAt,
            maxWallTimeMs: execution.budget.deadlineAt
              ? Math.max(0, execution.budget.deadlineAt - execution.budget.startedAt)
              : Number.MAX_SAFE_INTEGER,
          } : undefined,
          onPolicyBudget: execution && ownerSessionId ? (childBudget) => {
            const registry = new TaskRegistry(createSessionTaskStore(ownerSessionId));
            releaseExecutionBudgetObserver = registerPolicyBudgetObserver(childBudget, (snapshot) => registry.updateExecutionBudget(execution!.id, {
              expectedGeneration: execution!.generation,
              toolCalls: snapshot.toolCalls,
              subagents: snapshot.subagents,
              childDepth: snapshot.childDepth,
              maxToolCalls: snapshot.maxToolCalls,
              maxSubagents: snapshot.maxSubagents,
              maxChildDepth: snapshot.maxChildDepth,
              deadlineAt: snapshot.wallStartedAt + snapshot.maxWallTimeMs,
            }).then(() => undefined));
          } : undefined,
          signal: executionController.signal,
        });
        result = await runPromise;
      } catch (error) {
        result = {
          text: error instanceof Error ? error.message : String(error),
          status: executionController.signal.aborted ? 'cancelled' : 'failed',
          subagentId: generateEventId('subagent'),
        };
      }
      let resultArtifact: ReturnType<typeof persistSubagentResult> | undefined;
      let resultPersistenceError: unknown;
      if (ownerSessionId) {
        try {
          resultArtifact = persistSubagentResult(ownerSessionId, execution?.id ?? result.subagentId, result);
        } catch (error) {
          resultPersistenceError = error;
        }
      }
      const envelope = resultPersistenceError
        ? { disposition: 'blocked' as const, summary: 'Subagent result persistence failed.', outputs: {}, error: resultPersistenceError instanceof Error ? resultPersistenceError.message : String(resultPersistenceError), missingRequirements: ['Durable result artifact'] }
        : normalizeSubagentResult(result.text, result.status, result.completionDeclaration, resultArtifact, result.sourceFailure);
      try {
        if (execution && ownerSessionId) {
          const registry = new TaskRegistry(createSessionTaskStore(ownerSessionId));
          const current = await registry.getExecution(execution.id);
          if (current && !['completed', 'partial', 'blocked', 'failed', 'cancelled', 'interrupted', 'cancelling'].includes(current.status)) {
            if (result.policyBudget) {
              await registry.updateExecutionBudget(execution.id, {
                expectedGeneration: execution.generation,
                toolCalls: result.policyBudget.toolCalls,
                subagents: result.policyBudget.subagents,
                childDepth: result.policyBudget.childDepth,
                maxToolCalls: result.policyBudget.maxToolCalls,
                maxSubagents: result.policyBudget.maxSubagents,
                maxChildDepth: result.policyBudget.maxChildDepth,
                deadlineAt: result.policyBudget.wallStartedAt + result.policyBudget.maxWallTimeMs,
              });
            }
            await registry.settleExecution(execution.id, {
              expectedGeneration: execution.generation,
              status: result.status === 'cancelled' ? (envelope.disposition === 'blocked' ? 'blocked' : 'cancelled') : result.status === 'failed' ? 'failed'
                : envelope.disposition === 'completed' ? 'completed' : envelope.disposition,
              result: envelope,
            });
          }
        }
      } catch (error) {
        if (execution && ownerSessionId) {
          const registry = new TaskRegistry(createSessionTaskStore(ownerSessionId));
          const current = await registry.getExecution(execution.id);
          if (current && !['completed', 'partial', 'blocked', 'failed', 'cancelled', 'interrupted', 'cancelling'].includes(current.status)) {
            const message = error instanceof Error ? error.message : String(error);
            await registry.settleExecution(execution.id, {
              expectedGeneration: execution.generation,
              status: 'failed',
              result: {
                disposition: 'blocked', summary: `Subagent Task settlement failed: ${message}`,
                outputs: {},
                resultRef: resultArtifact?.uri, resultHash: resultArtifact?.hash,
              },
            });
          }
        }
        throw error;
      } finally {
        releaseExecutionBudgetObserver?.();
        unregisterOwner?.();
        sourceSignal?.removeEventListener('abort', forwardAbort);
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(projectSubagentResult(envelope)) }],
        isError: result.status !== 'complete',
        details: {
          subagentId: result.subagentId,
          profile: targetProfile,
          status: result.status,
          executionId: execution?.id,
          generation: execution?.generation,
          errorCode: envelope.error === 'POLICY_LIMIT_EXCEEDED: maxWallTimeMs' ? 'POLICY_LIMIT_EXCEEDED'
            : result.status === 'cancelled' ? 'SUBAGENT_CANCELLED' : result.status === 'failed'
              ? envelope.error === 'ARTIFACT_NOT_FOUND' ? envelope.error : 'SUBAGENT_FAILED' : undefined,
        },
      };
    },
  };

  return [runSubagentTool];
}
