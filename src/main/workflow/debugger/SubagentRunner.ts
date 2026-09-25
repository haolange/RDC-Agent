import { withDelegatedInteractionOwner } from '../../agent-runtime/interactions/DelegatedInteractionOwner';
import { deriveChildPolicyBudget, flushPolicyBudgetObservers, registerPolicyBudgetObserver } from './DelegationBudget';
import { bindTaskRootBudget } from './TaskRootBudget';
import { grantDelegatedArtifactAccess } from '../../sessions/DelegatedArtifactAccess';
import { shellInvocationService } from '../../tools/ShellInvocationService';
import { getRdcContextLease } from '../../sessions/RdcRuntimeContextRegistry';
import { renderDelegationCapsuleInput } from '../../agent-runtime/prompt/DelegationCapsuleCompiler';
import { processSupervisor } from '../../runtime/ProcessSupervisor';
import { resolveRdcDelegation } from '../../sessions/RdcDelegation';
/**
 * SubagentRunner — isolated sub-agent turns and the subagent tool.
 * Capsule fields are required. Dispatch may run concurrently; domain lease
 * admission and child tool effects enforce the actual resource constraints.
 */

import type { AgentRole } from '@shared/types/agent';
import type {
  AgentEvent as SharedAgentEvent,
} from '@shared/types/agentRuntime';
import { generateEventId, nowMs } from '@shared/utils/id';
import type { AgentTool } from '../../agent-runtime/agent/AgentTool';
import { settingsService } from '../../settings/SettingsService';
import { agentManifestService } from '../../settings/AgentManifestService';
import {
  assertSubagentBudgetAllowsChild,
  consumeReservedSubagentSlot,
  createSubagentBudgetState,
  createPolicyBudgetState,
  reserveDispatchBudget,
  type SubagentResultStatus,
  type TurnHandle,
} from './TurnCoordinator';
import type { AgentProfileTurnOptions } from './orchestratorTypes';
import { createEphemeralScopeId } from './executionScope';
import { resolveSubagentModelOverride } from './subagentModelArg';
import {
  DELEGATION_CAPSULE_JSON_SCHEMA,
  freezeDelegationCapsule,
  parseDelegationCapsule,
  type DelegationCapsule,
} from '@shared/types/delegationCapsule';
import { compileDelegationCapsule } from '../../agent-runtime/prompt/DelegationCapsuleCompiler';
import {
  grantDelegatedLease,
  revokeDelegatedLease,
} from '../../sessions/RdcRuntimeContextRegistry';
import {
  TaskRegistry,
  createSessionTaskStore,
  registerTaskExecutionCancellationOwner,
  type TaskExecutionRecord,
  registerDelegatedTaskScope,
  getDelegatedTaskScope,
} from '../../agent-runtime/tasks';
import type { BackgroundSubagentStart } from './BackgroundSubagentService';
import { createHash } from 'node:crypto';
import { normalizeSubagentResult, persistSubagentResult, projectSubagentResult } from './SubagentResultEnvelope';
import { delegationTraceStore } from '../../conversation/DelegationTraceStore';

export interface SubagentRunnerDeps {
  sendProfileMessage: (
    agentId: AgentRole,
    content: string,
    options?: AgentProfileTurnOptions,
  ) => Promise<string>;
  systemPromptForAgent: (agentId: AgentRole, prompt?: string) => string;
  getActiveTurn: (sessionId?: string | null) => TurnHandle | null;
}

export class SubagentRunner {
  private startBackground?: (input: BackgroundSubagentStart) => Promise<TaskExecutionRecord>;

  constructor(private readonly deps: SubagentRunnerDeps) {}

  setBackgroundStarter(starter: (input: BackgroundSubagentStart) => Promise<TaskExecutionRecord>): void {
    this.startBackground = starter;
  }

  async runSubagent(input: {
    parentAgentId: AgentRole;
    parentToolCallId: string;
    targetProfile: AgentRole;
    capsule: DelegationCapsule;
    parentSessionId?: string | null;
    parentOnEvent?: (event: SharedAgentEvent) => void;
    projectRootPath?: string | null;
    projectId?: string | null;
    parentTurn?: TurnHandle | null;
    detached?: boolean;
    policyBudget?: TurnHandle['policyBudget'];
    restoredPolicyBudget?: TurnHandle['policyBudget'];
    onPolicyBudget?: (budget: TurnHandle['policyBudget']) => void;
    subagentBudget?: TurnHandle['subagentBudget'];
    signal?: AbortSignal | null;
    model?: string;
    childSessionId?: string;
    taskId?: string;
    executionId?: string;
    taskExecutionGeneration?: number;
    beforeProviderRequestMessages?: AgentProfileTurnOptions['beforeProviderRequestMessages'];
    onProviderRequestCommitted?: AgentProfileTurnOptions['onProviderRequestCommitted'];
  }): Promise<{ text: string; status: SubagentResultStatus; subagentId: string; policyBudget?: TurnHandle['policyBudget']; completionDeclaration?: import('./TurnCoordinator').TurnCompletionDeclaration | null }> {
    const capsule = input.capsule;
    const rdcDelegation = resolveRdcDelegation(capsule.domainExtensions);
    const task = capsule.task;
    // Resolve and authorize the exact project profile before mutating parent budgets or emitting a child event.
    const childSettings = settingsService.getAll();
    const effectiveProfiles = childSettings.paths
      ? agentManifestService.getEffectiveProfiles(
          childSettings.paths,
          childSettings.llm?.providers ?? [],
          childSettings.llm?.agentRoutes ?? [],
          input.projectRootPath ?? undefined,
        )
      : [];
    const definition = effectiveProfiles.find((entry) => entry.id === input.targetProfile && entry.enabled);
    if (!definition) {
      throw new Error('AGENT_PROFILE_UNAVAILABLE: ' + input.targetProfile);
    }
    let modelOverride: { providerId: string; modelId: string } | undefined;
    try {
      modelOverride = resolveSubagentModelOverride(input.model, childSettings);
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const subagentId = generateEventId('subagent');
      const childSessionId = input.childSessionId ?? `${input.parentSessionId ?? 'ephemeral'}::subagent::${subagentId}`;
      const ownerSessionId = input.parentSessionId?.split('::subagent::')[0];
      if (ownerSessionId) {
        delegationTraceStore.start(ownerSessionId, {
          parentToolCallId: input.parentToolCallId, task, profile: input.targetProfile,
          mode: input.detached ? 'background' : 'wait', executionId: input.executionId,
          generation: input.taskExecutionGeneration, taskId: input.taskId,
          childSessionId, invocation: JSON.stringify(capsule), status: 'running', startedAt: nowMs(),
        });
        delegationTraceStore.finish(ownerSessionId, input.parentToolCallId,
          `${childSessionId}\u0000${input.executionId ?? ''}\u0000${input.taskExecutionGeneration ?? ''}`, 'failed', text);
      }
      return { text, status: 'failed', subagentId };
    }
    const effectiveProfileIds = effectiveProfiles.filter((entry) => entry.enabled).map((entry) => entry.id);
    const systemPrompt = definition.instructions?.trim() || this.deps.systemPromptForAgent(input.targetProfile);

    const parentBudget = input.subagentBudget ?? input.parentTurn?.subagentBudget ?? createSubagentBudgetState();
    assertSubagentBudgetAllowsChild(parentBudget);
    const policyBudget = input.policyBudget ?? input.parentTurn?.policyBudget;
    if (policyBudget && parentBudget.depth >= policyBudget.maxChildDepth) {
      throw new Error(`POLICY_LIMIT_EXCEEDED: maxChildDepth ${policyBudget.maxChildDepth}.`);
    }
    const prepaid = consumeReservedSubagentSlot(policyBudget);
    if (policyBudget && !prepaid) {
      if (Date.now() - policyBudget.wallStartedAt >= policyBudget.maxWallTimeMs) {
        throw new Error(`POLICY_LIMIT_EXCEEDED: maxWallTimeMs ${policyBudget.maxWallTimeMs}.`);
      }
      if (policyBudget.subagents >= policyBudget.maxSubagents) {
        throw new Error(`POLICY_LIMIT_EXCEEDED: maxSubagents ${policyBudget.maxSubagents}.`);
      }
      const reserved = reserveDispatchBudget(policyBudget, { toolCalls: 0, subagents: 1 });
      if (!reserved.ok) throw new Error(`POLICY_LIMIT_EXCEEDED: ${reserved.limit}.`);
      await flushPolicyBudgetObservers(policyBudget);
      consumeReservedSubagentSlot(policyBudget);
    }
    const childPolicyBudget = deriveChildPolicyBudget(policyBudget ?? createPolicyBudgetState(), capsule.budget, input.restoredPolicyBudget);
    parentBudget.childrenSpawned += 1;

    const subagentId = generateEventId('subagent');
    // 子 agent 用独立 sessionId 段隔离 context/messages（不污染父线程持久化）。
    const subagentSessionId = input.childSessionId ?? (input.parentSessionId
      ? `${input.parentSessionId}::subagent::${subagentId}`
      : createEphemeralScopeId());

    const childAbort = new AbortController();
    const remainingWallMs = childPolicyBudget.wallStartedAt + childPolicyBudget.maxWallTimeMs - Date.now();
    const deadlineTimer = setTimeout(() => childAbort.abort(new Error('POLICY_LIMIT_EXCEEDED: maxWallTimeMs')), Math.max(0, Math.min(remainingWallMs, 2_147_000_000)));
    deadlineTimer.unref?.();
    const parentSignal = input.detached ? (input.signal ?? null) : (input.signal ?? input.parentTurn?.signal ?? null);
    const onParentAbort = () => {
      try {
        childAbort.abort();
      } catch {
        // ignore
      }
    };
    if (parentSignal) {
      if (parentSignal.aborted) onParentAbort();
      else parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }

    const ownerSessionId = input.parentSessionId?.split('::subagent::')[0] ?? null;
    const traceIdentity = `${subagentSessionId}\u0000${input.executionId ?? ''}\u0000${input.taskExecutionGeneration ?? ''}`;
    if (ownerSessionId) delegationTraceStore.start(ownerSessionId, {
      parentToolCallId: input.parentToolCallId, task, profile: input.targetProfile,
      mode: input.detached ? 'background' : 'wait', executionId: input.executionId,
      generation: input.taskExecutionGeneration, taskId: input.taskId,
      childSessionId: subagentSessionId, invocation: JSON.stringify(capsule),
      status: 'running', startedAt: nowMs(),
    });

    // 组装子 agent system prompt（目标 profile instructions）
    let resultText = '';
    let resultStatus: SubagentResultStatus = 'complete';
    let childPromise: Promise<string> | null = null;
    let completionDeclaration: import('./TurnCoordinator').TurnCompletionDeclaration | null = null;
    const seenToolCallIds = new Set<string>();
    const childBudget = createSubagentBudgetState({
      ...parentBudget.budget,
      maxDepth: policyBudget?.maxChildDepth ?? parentBudget.budget.maxDepth,
      maxChildren: policyBudget?.maxSubagents ?? parentBudget.budget.maxChildren,
      maxAggregateToolCalls: policyBudget?.maxToolCalls ?? parentBudget.budget.maxAggregateToolCalls,
    }, parentBudget.depth + 1);
    childBudget.aggregateToolCalls = parentBudget.aggregateToolCalls;
    childBudget.wallStartedAt = parentBudget.wallStartedAt;

    const unregisterProducer = input.detached ? undefined : input.parentTurn?.registerProducer({
      id: subagentId,
      abort: () => onParentAbort(),
      join: async () => {
        if (childPromise) await childPromise.catch(() => undefined);
      },
    });

    let releaseArtifacts: (() => void) | undefined;
    const inheritedTaskScope = input.parentSessionId ? getDelegatedTaskScope(input.parentSessionId) : null;
    const releaseTaskScope = input.taskId && input.parentSessionId
      ? registerDelegatedTaskScope(subagentSessionId, {
        ownerSessionId: inheritedTaskScope?.ownerSessionId ?? input.parentSessionId,
        rootTaskId: input.taskId,
        executionId: input.executionId,
        generation: input.taskExecutionGeneration,
      })
      : undefined;
    try {
      if (childAbort.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      input.onPolicyBudget?.(childPolicyBudget);
      const frozenCapsule = freezeDelegationCapsule(capsule);
      if (input.parentSessionId) {
        releaseArtifacts = grantDelegatedArtifactAccess(subagentSessionId, input.parentSessionId, [...new Set([
          ...frozenCapsule.inputArtifactRefs, ...frozenCapsule.challengeRefs,
          ...frozenCapsule.acceptedFacts.flatMap(fact => fact.sourceRefs),
        ])]);
      } else if (frozenCapsule.inputArtifactRefs.length || frozenCapsule.challengeRefs.length || frozenCapsule.acceptedFacts.some(fact => fact.sourceRefs.length)) {
        throw new Error('ARTIFACT_SESSION_DENIED: delegation references require a parent session.');
      }
      const ownedTask = input.taskId && input.parentSessionId
        ? await new TaskRegistry(createSessionTaskStore(inheritedTaskScope?.ownerSessionId ?? input.parentSessionId)).getTask(input.taskId)
        : null;
      const taskContract = ownedTask ? '\nRuntime Task completion contract (output keys, not source instructions): ' + JSON.stringify({
        taskId: ownedTask.id, completionRequirements: ownedTask.completionRequirements,
        rule: 'Return every completionRequirements string verbatim as a key in turn_complete.result.outputs. Values are complete strings. Runtime persists the result; do not invent its reference.',
      }) : '';
      if (ownerSessionId) delegationTraceStore.updateTask(ownerSessionId, input.parentToolCallId, traceIdentity,
        { capsule: frozenCapsule, completionRequirements: ownedTask?.completionRequirements ?? [] },
        renderDelegationCapsuleInput(frozenCapsule) + taskContract);
      const capsuleSegments = [...compileDelegationCapsule(frozenCapsule), ...rdcDelegation.segments];
      if (rdcDelegation.requiresLease) {
        if (!input.parentSessionId?.trim()) {
          throw new Error('RDC_LEASE_DELEGATE_DENIED: RDC capability requested but no parent session.');
        }
        const ownerTurnId = input.parentTurn?.turnId?.trim() ?? '';
        if (!ownerTurnId) {
          throw new Error('RDC_LEASE_DELEGATE_DENIED: RDC capability requested but parent turn id is missing.');
        }
        grantDelegatedLease({
          parentSessionId: input.parentSessionId,
          childSessionId: subagentSessionId,
          ...(input.projectId ? { projectId: input.projectId } : {}),
          ownerTurnId,
        });
      }
      childPromise = withDelegatedInteractionOwner({ ownerSessionId: input.parentSessionId ?? subagentSessionId, childSessionId: subagentSessionId, executionId: input.executionId ?? subagentId }, () => this.deps.sendProfileMessage(
        input.targetProfile,
        renderDelegationCapsuleInput(frozenCapsule) + taskContract,
        {
          sessionId: subagentSessionId,
          projectRootPath: input.projectRootPath,
          projectId: input.projectId,
          systemPrompt,
          effectiveProfile: definition ?? null,
          effectiveProfileIds,
          signal: childAbort.signal,
          policyBudget: childPolicyBudget,
          subagentBudget: childBudget,
          modelOverride: modelOverride ?? null,
          ...(frozenCapsule.reasoningLevel ? { turnControls: { reasoningLevel: frozenCapsule.reasoningLevel, maxContextMode: false, fastModel: false } } : {}),
          extraPromptSegments: capsuleSegments,
          frozenDelegationCapsule: frozenCapsule,
          preloadSkillIds: frozenCapsule.requiredSkillIds,
          beforeProviderRequestMessages: input.beforeProviderRequestMessages,
          onProviderRequestCommitted: input.onProviderRequestCommitted,
          excludeRdcLeaseTools: !rdcDelegation.requiresLease,
          onTerminalContext: (terminal) => { completionDeclaration = terminal.completionDeclaration ?? null; },
          onEvent: (event: SharedAgentEvent) => {
            if (event.type === 'approval.requested' || event.type === 'approval.answered') {
              if (ownerSessionId) delegationTraceStore.event(ownerSessionId, input.parentToolCallId, traceIdentity, event);
              input.parentOnEvent?.(event);
              return;
            }
            if (!input.detached && input.parentTurn && !input.parentTurn.isLive(input.parentTurn.generation)) {
              return;
            }
            if (ownerSessionId) delegationTraceStore.event(ownerSessionId, input.parentToolCallId, traceIdentity, event);
            if (ownerSessionId && event.type === 'tool.completed') {
              const completed = event.payload as { toolCallId?: string; toolName?: string; result?: unknown };
              if (completed.toolName === 'subagent' && completed.toolCallId && completed.result !== undefined) {
                delegationTraceStore.setParentReceipt(ownerSessionId, completed.toolCallId, completed.result);
              }
            }
            if (event.type === 'tool.started' || event.type === 'tool.completed' || event.type === 'tool.denied') {
              const toolPayload = event.payload as { toolCallId?: string };
              const toolCallId = typeof toolPayload.toolCallId === 'string' ? toolPayload.toolCallId.trim() : '';
              // Count once per unique toolCallId; skip events without a stable id.
              if (toolCallId && !seenToolCallIds.has(toolCallId)) {
                seenToolCallIds.add(toolCallId);
                parentBudget.aggregateToolCalls += 1;
                childBudget.aggregateToolCalls = parentBudget.aggregateToolCalls;
              }
            }
          },
        },
      ));
      resultText = await childPromise;
      if (childAbort.signal.aborted) {
        resultStatus = 'cancelled';
      }
    } catch (error) {
      const aborted = childAbort.signal.aborted
        || (error instanceof Error && error.name === 'AbortError');
      resultStatus = aborted ? 'cancelled' : 'failed';
      resultText = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(deadlineTimer);
      await processSupervisor.joinExecutionProcesses(subagentSessionId);
      const lease = getRdcContextLease(subagentSessionId);
      revokeDelegatedLease(subagentSessionId, { operationStopped: !!lease && !shellInvocationService.hasUnconfirmedProcesses(lease.contextId) });
      releaseArtifacts?.();
      releaseTaskScope?.();
      unregisterProducer?.();
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
      // Propagate child budget usage back to parent.
      parentBudget.aggregateToolCalls = Math.max(
        parentBudget.aggregateToolCalls,
        childBudget.aggregateToolCalls,
      );
    }

    if (ownerSessionId) delegationTraceStore.finish(ownerSessionId, input.parentToolCallId, traceIdentity, resultStatus, resultText);

    return { text: resultText, status: resultStatus, subagentId, policyBudget: childPolicyBudget, completionDeclaration };
  }

  createSubagentTools(parentAgentId: AgentRole, sessionId?: string | null, turnHandle?: TurnHandle | null): AgentTool[] {
    const getActiveTurn = this.deps.getActiveTurn;
    const runSubagent = this.runSubagent.bind(this);
    const startBackground = this.startBackground;
    const capturedTurn = turnHandle ?? getActiveTurn(sessionId);
    const runSubagentTool: AgentTool<
      Record<string, unknown>,
      { subagentId: string; profile: string; status: string; executionId?: string; generation?: number }
    > = {
      name: 'subagent',
      label: 'Subagent',
      description: 'Delegate a structured Delegation Capsule to an isolated sub-agent. Required fields include goal, task, scope, qualified acceptedFacts, hypotheses, challengeRefs, conditional negativePaths, inputArtifactRefs, requiredSkillIds, stopConditions, outputRequirements and budget. mode=wait waits; mode=background requires taskId and returns its execution id. Capability requests do not grant authority; domain admission and tool resource locks enforce exclusive effects. Optional model is a canonical providerId:modelId and does not inherit the parent session override.',
      parameters: {
        ...DELEGATION_CAPSULE_JSON_SCHEMA,
        properties: {
          ...DELEGATION_CAPSULE_JSON_SCHEMA.properties,
          taskId: { type: 'string', description: 'Optional logical Task to own this execution.' },
          parentExecutionId: { type: 'string', description: 'Optional parent Task execution.' },
          mode: { type: 'string', enum: ['wait', 'background'], description: 'Wait for the result or return a durable execution id immediately.' },
        },
      } as unknown as AgentTool['parameters'],
      permissionHint: 'readonly',
      spec: {
        isReadOnly: true,
        isConcurrencySafe: true,
        orchestration: true,
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
        const turn = capturedTurn ?? getActiveTurn(sessionId);
        const targetProfile = (capsule.profile?.trim() || parentAgentId) as AgentRole;
        const delegates = turn?.runtimePlan?.profileDelegates ?? [];
        const authorized = delegates.length === 0
          ? targetProfile === parentAgentId
          : targetProfile === parentAgentId || delegates.includes(targetProfile);
        if (!authorized) {
          throw new Error(`SUBAGENT_DELEGATE_DENIED: ${targetProfile} is not in the frozen profileDelegates set.`);
        }
        const resolvedSessionId = sessionId ?? turn?.eventSink?.sessionId ?? null;
        const inheritedScope = resolvedSessionId ? getDelegatedTaskScope(resolvedSessionId) : null;
        const ownerSessionId = inheritedScope?.ownerSessionId ?? resolvedSessionId;
        if (inheritedScope?.executionId && parentExecutionId && parentExecutionId !== inheritedScope.executionId) {
          throw new Error('TASK_SCOPE_DENIED: parentExecutionId must match the delegated execution binding.');
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
          if (!allowed) throw new Error('TASK_SCOPE_DENIED: nested delegation must target a descendant of the owning Task.');
        }
        if (mode === 'background') {
          if (!taskId || !ownerSessionId || !startBackground) {
            throw new Error('BACKGROUND_REQUIRES_TASK: background mode requires a session-owned task and background runtime.');
          }
          const execution = await startBackground({
            sessionId: ownerSessionId,
            parentToolCallId: toolCallId,
            originSessionId: resolvedSessionId ?? ownerSessionId,
            taskId,
            parentExecutionId: effectiveParentExecutionId,
            parentAgentId,
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
        let runPromise: Promise<Awaited<ReturnType<typeof runSubagent>>> | undefined;
        let releaseExecutionBudgetObserver: (() => void) | undefined;
        if (taskId) {
          if (!ownerSessionId) throw new Error('TASK_EXECUTION_SESSION_REQUIRED: task-owned subagent requires a parent session.');
          const registry = new TaskRegistry(createSessionTaskStore(ownerSessionId));
          const parentExecution = effectiveParentExecutionId
            ? await registry.getExecution(effectiveParentExecutionId)
            : null;
          const previousExecution = (await registry.listExecutions(taskId)).at(-1);
          const rootBudgetId = parentExecution?.rootBudgetId ?? (turn?.policyBudget
            ? await bindTaskRootBudget(registry, ownerSessionId, turn.policyBudget, previousExecution?.rootBudgetId)
            : undefined);
          execution = await registry.startExecution(taskId, {
            mode: 'subagent',
            parentExecutionId: effectiveParentExecutionId,
            rootBudgetId,
            frozenPlanRef: `capsule:sha256:${createHash('sha256').update(JSON.stringify(capsule)).digest('hex')}`,
            budget: turn?.policyBudget ? {
              maxToolCalls: turn.policyBudget.maxToolCalls,
              toolCalls: turn.policyBudget.toolCalls,
              maxSubagents: turn.policyBudget.maxSubagents,
              subagents: turn.policyBudget.subagents,
              maxChildDepth: turn.policyBudget.maxChildDepth,
              childDepth: turn.subagentBudget.depth,
              deadlineAt: turn.policyBudget.wallStartedAt + turn.policyBudget.maxWallTimeMs,
            } : undefined,
          });
          unregisterOwner = registerTaskExecutionCancellationOwner(execution.id, async () => {
            executionController.abort();
            await runPromise?.catch(() => undefined);
          });
        }
        if (!sourceSignal?.aborted) sourceSignal?.addEventListener('abort', forwardAbort, { once: true });
        let result: Awaited<ReturnType<typeof runSubagent>>;
        try {
          runPromise = runSubagent({
            parentAgentId,
            parentToolCallId: toolCallId,
            targetProfile,
            capsule,
            model: capsule.model,
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
          : normalizeSubagentResult(result.text, result.status, result.completionDeclaration, resultArtifact);
        try {
          if (execution && ownerSessionId) {
            const registry = new TaskRegistry(createSessionTaskStore(ownerSessionId));
            const current = await registry.getExecution(execution.id);
            if (current?.status !== 'cancelling') {
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
                status: result.status === 'cancelled' ? 'cancelled' : result.status === 'failed' ? 'failed'
                  : envelope.disposition === 'completed' ? 'completed' : envelope.disposition,
                result: envelope,
              });
            }
          }
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
            errorCode: result.status === 'cancelled' ? 'SUBAGENT_CANCELLED' : result.status === 'failed' ? 'SUBAGENT_FAILED' : undefined,
          },
        };
      },
    };

    return [runSubagentTool];
  }
}
