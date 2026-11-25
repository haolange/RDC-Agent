import { createHash } from 'node:crypto';
import { isTransientScopeId, rootScopeId, subagentScopeId } from '@shared/utils/executionScope';
import { isRdcLeaseToolName } from '@shared/constants/rdcLeaseTools';
import { agentAccessCeiling, type AgentAccessCeiling } from '@shared/types/agentManifest';
import { generateEventId, nowMs } from '@shared/utils/id';
import { AppError } from '@shared/errors/appError';
import { SessionArtifactError } from '../../sessions/artifacts/sessionArtifactContract';
import { narrowerAccessCeiling } from '../../settings/agent-manifests/accessCeiling';
import { withDelegatedInteractionOwner } from '../interactions/DelegatedInteractionOwner';
import { investigationArtifactService } from '../../investigation/InvestigationArtifactService';
import { reviewEvidenceClosure } from '../../investigation/reviewEvidenceClosure';
import { delegatedArtifactOwner, delegatedArtifactReferences, grantDelegatedArtifactAccess } from '../../sessions/artifacts/DelegatedArtifactAccess';
import { shellInvocationService } from '../../tools/ShellInvocationService';
import { getRdcContextLease } from '../../rdc/RdcRuntimeContextRegistry';
import { delegationCapsuleArtifactRefs, renderDelegationCapsuleInput } from '../prompt/DelegationCapsuleCompiler';
import { processSupervisor } from '../../runtime/ProcessSupervisor';
import { resolveRdcDelegation } from '../../rdc/RdcDelegation';
/**
 * SubagentRunner — isolated sub-agent turns and the subagent tool.
 * Capsule fields are required. Dispatch may run concurrently; domain lease
 * admission and child tool effects enforce the actual resource constraints.
 */

import { appPathService } from '../../runtime/AppPathService';
import { agentManifestService } from '../../settings/agent-manifests/AgentManifestService';
import { compileDelegationCapsule } from '../prompt/DelegationCapsuleCompiler';
import {
  grantDelegatedLease,
  revokeDelegatedLease,
} from '../../rdc/RdcRuntimeContextRegistry';
import { TaskRegistry, createSessionTaskStore, releaseScopeTaskStore, type TaskExecutionRecord, registerDelegatedTaskScope, getDelegatedTaskScope } from '../tasks';
import { delegationTraceStore } from '../workTrace/DelegationTraceStore';
import { freezeDelegationCapsule } from './delegationCapsule';
import { createEphemeralScopeId } from './executionScope';
import {
  APPROVED_CAPTURE_SCOPE_REQUIRED,
  assertSubagentBudgetAllowsChild,
  consumeReservedSubagentSlot,
  createSubagentBudgetState,
  createPolicyBudgetState,
  finishSubagentBudgetChild,
  reserveDispatchBudget,
  startSubagentBudgetChild,
  subagentActiveWallMs,
  type SubagentResultStatus,
  type TurnHandle,
} from './TurnCoordinator';
import { deriveChildPolicyBudget, flushPolicyBudgetObservers } from './DelegationBudget';
import { DelegationConfigurationError } from './DelegationConfigurationError';
import { createSubagentTools, type SubagentToolHost } from './SubagentTool';
import type { DelegationCapsule } from './delegationCapsule';
import type { DelegationSourceFailure } from './SubagentResultEnvelope';
import type { BackgroundSubagentStart } from './BackgroundSubagentService';
import type { ActiveTurnLookup, AgentProfileTurnOptions } from './orchestratorTypes';
import type { ProfileTurnRequest } from './ProfileTurnRunner';
import type { AgentTool } from '../agent/AgentTool';
import type {
  AgentEvent,
} from '@shared/types/agentRuntime';
import type { AgentRole } from '@shared/types/agent';

/** Prepares and runs one child profile turn (ProfileTurnRunner). */
export interface ProfileTurnSender {
  runChildTurn(request: ProfileTurnRequest): Promise<string>;
}

/** The system prompt an Agent runs with when its definition has no instructions (PromptPlanForTurn). */
export interface SystemPromptSource {
  systemPromptForAgent(agentId: AgentRole, prompt?: string): string;
}

export interface SubagentRunnerDeps {
  prompts: SystemPromptSource;
  activeTurns: ActiveTurnLookup;
}

export class SubagentRunner implements SubagentToolHost {
  readonly activeTurns: ActiveTurnLookup;
  startBackground?: (input: BackgroundSubagentStart) => Promise<TaskExecutionRecord>;
  private profileTurns!: ProfileTurnSender;

  constructor(private readonly deps: SubagentRunnerDeps) {
    this.activeTurns = deps.activeTurns;
  }

  /** Wired once by the composition root: a child turn runs through the profile-turn runner whose tools include this runner's. */
  bindProfileTurns(profileTurns: ProfileTurnSender): void {
    this.profileTurns = profileTurns;
  }

  setBackgroundStarter(starter: (input: BackgroundSubagentStart) => Promise<TaskExecutionRecord>): void {
    this.startBackground = starter;
  }

  async runSubagent(input: {
    parentAgentId: AgentRole;
    parentToolCallId: string;
    targetProfile: AgentRole;
    capsule: DelegationCapsule;
    parentSessionId?: string | null;
    parentOnEvent?: (event: AgentEvent) => void;
    projectRootPath?: string | null;
    projectId?: string | null;
    parentTurn?: TurnHandle | null;
    /** The delegating turn's frozen ceiling; the child runs with the stricter of it and its own. */
    parentAccessCeiling: AgentAccessCeiling;
    detached?: boolean;
    policyBudget?: TurnHandle['policyBudget'];
    restoredPolicyBudget?: TurnHandle['policyBudget'];
    onPolicyBudget?: (budget: TurnHandle['policyBudget']) => void;
    subagentBudget?: TurnHandle['subagentBudget'];
    signal?: AbortSignal | null;
    childSessionId?: string;
    taskId?: string;
    executionId?: string;
    taskExecutionGeneration?: number;
    beforeProviderRequestMessages?: AgentProfileTurnOptions['beforeProviderRequestMessages'];
    onProviderRequestCommitted?: AgentProfileTurnOptions['onProviderRequestCommitted'];
  }): Promise<{ text: string; status: SubagentResultStatus; subagentId: string; policyBudget?: TurnHandle['policyBudget']; completionDeclaration?: import('./TurnCoordinator').TurnCompletionDeclaration | null; sourceFailure?: DelegationSourceFailure }> {
    const capsule = input.capsule;
    const rdcDelegation = resolveRdcDelegation(capsule.domainExtensions);
    const parentTurn = input.parentTurn ?? this.activeTurns.getActiveTurn(input.parentSessionId);
    if (rdcDelegation.requiresLease && parentTurn?.requiresApprovedCaptureScope) {
      throw new Error(APPROVED_CAPTURE_SCOPE_REQUIRED);
    }
    const task = capsule.task;
    // Resolve and authorize the exact project profile before mutating parent budgets or emitting a child event.
    const effectiveProfiles = agentManifestService.getEffectiveProfiles(
      appPathService.getRuntimePaths(),
      input.projectRootPath ?? undefined,
    );
    const rejectConfiguration = (code: DelegationConfigurationError['code'], text: string) => {
      const subagentId = generateEventId('subagent');
      const childSessionId = input.childSessionId ?? subagentScopeId(input.parentSessionId ?? createEphemeralScopeId(), subagentId);
      const ownerSessionId = (input.parentSessionId ? rootScopeId(input.parentSessionId) : undefined);
      if (ownerSessionId) {
        delegationTraceStore.start(ownerSessionId, {
          parentToolCallId: input.parentToolCallId, task, profile: input.targetProfile,
          mode: input.detached ? 'background' : 'wait', executionId: input.executionId,
          generation: input.taskExecutionGeneration, taskId: input.taskId,
          childSessionId, invocation: JSON.stringify(capsule), status: 'running', startedAt: nowMs(),
        });
        delegationTraceStore.finish(ownerSessionId, input.parentToolCallId,
          `${childSessionId}\u0000${input.executionId ?? ''}\u0000${input.taskExecutionGeneration ?? ''}`, 'failed', text, code);
      }
      return { text, status: 'failed' as const, subagentId };
    };
    const targetDefinition = effectiveProfiles.find((entry) => entry.id === input.targetProfile && entry.enabled);
    if (!targetDefinition) {
      return rejectConfiguration('AGENT_PROFILE_UNAVAILABLE', 'AGENT_PROFILE_UNAVAILABLE: ' + input.targetProfile);
    }
    // A child never does more than the turn that delegated to it.
    const definition = {
      ...targetDefinition,
      accessCeiling: narrowerAccessCeiling(agentAccessCeiling(targetDefinition), input.parentAccessCeiling),
    };
    if (rdcDelegation.requiresLease && !definition.tools.some(tool => isRdcLeaseToolName(tool)
      || (tool === 'shell' && agentAccessCeiling(definition) === 'full'))) {
      throw new AppError('RDC_LEASE_DELEGATE_DENIED', 'target Agent has no live RDC capability.');
    }
    if (!definition.compiledRoute?.providerId || !definition.compiledRoute.modelId) {
      return rejectConfiguration('MODEL_ROUTE_REQUIRED', `MODEL_ROUTE_REQUIRED: ${input.targetProfile} has no configured model route; configure this Agent in Settings.`);
    }
    const effectiveProfileIds = effectiveProfiles.filter((entry) => entry.enabled).map((entry) => entry.id);
    const systemPrompt = definition.instructions?.trim() || this.deps.prompts.systemPromptForAgent(input.targetProfile);

    const parentBudget = input.subagentBudget ?? input.parentTurn?.subagentBudget ?? createSubagentBudgetState();
    assertSubagentBudgetAllowsChild(parentBudget);
    const policyBudget = input.policyBudget ?? input.parentTurn?.policyBudget;
    if (policyBudget && parentBudget.depth >= policyBudget.maxChildDepth) {
      throw new AppError('POLICY_LIMIT_EXCEEDED', `maxChildDepth ${policyBudget.maxChildDepth}.`);
    }
    const prepaid = consumeReservedSubagentSlot(policyBudget);
    if (policyBudget && !prepaid) {
      if (Date.now() - policyBudget.wallStartedAt >= policyBudget.maxWallTimeMs) {
        throw new AppError('POLICY_LIMIT_EXCEEDED', `maxWallTimeMs ${policyBudget.maxWallTimeMs}.`);
      }
      if (policyBudget.subagents >= policyBudget.maxSubagents) {
        throw new AppError('POLICY_LIMIT_EXCEEDED', `maxSubagents ${policyBudget.maxSubagents}.`);
      }
      const reserved = reserveDispatchBudget(policyBudget, { toolCalls: 0, subagents: 1 });
      if (!reserved.ok) throw new AppError('POLICY_LIMIT_EXCEEDED', `${reserved.limit}.`);
      await flushPolicyBudgetObservers(policyBudget);
      consumeReservedSubagentSlot(policyBudget);
    }
    const childPolicyBudget = deriveChildPolicyBudget(policyBudget ?? createPolicyBudgetState(), capsule.budget, input.restoredPolicyBudget);

    const subagentId = generateEventId('subagent');
    // 子 agent 用独立 sessionId 段隔离 context/messages（不污染父线程持久化）。
    const subagentSessionId = input.childSessionId ?? (input.parentSessionId
      ? subagentScopeId(input.parentSessionId, subagentId)
      : createEphemeralScopeId());

    const childAbort = new AbortController();
    let deadlineTimer: NodeJS.Timeout | undefined;
    const armDeadline = () => {
      const remaining = childPolicyBudget.wallStartedAt + childPolicyBudget.maxWallTimeMs - Date.now();
      deadlineTimer = setTimeout(() => {
        if (remaining > 2_147_000_000) armDeadline();
        else childAbort.abort(new AppError('POLICY_LIMIT_EXCEEDED', 'maxWallTimeMs'));
      }, Math.max(0, Math.min(remaining, 2_147_000_000)));
      deadlineTimer.unref?.();
    };
    if (childPolicyBudget.maxWallTimeMs < Number.MAX_SAFE_INTEGER) armDeadline();
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

    const ownerSessionId = (input.parentSessionId ? rootScopeId(input.parentSessionId) : null);
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
    let sourceFailure: DelegationSourceFailure | undefined;
    let configurationError: DelegationConfigurationError['code'] | undefined;
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

    let finishLifecycle!: () => void;
    const lifecycleFinished = new Promise<void>(resolve => { finishLifecycle = resolve; });
    const unregisterProducer = input.detached ? undefined : input.parentTurn?.registerProducer({
      id: subagentSessionId,
      abort: () => onParentAbort(),
      join: () => lifecycleFinished,
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
    const childStartedAt = Date.now();
    startSubagentBudgetChild(parentBudget, childStartedAt);
    childBudget.wallStartedAt = childStartedAt - subagentActiveWallMs(parentBudget, childStartedAt);
    // The child's own turn is active throughout nested delegations.
    childBudget.activeChildren = 1;
    try {
      if (childAbort.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      input.onPolicyBudget?.(childPolicyBudget);
      const frozenCapsule = freezeDelegationCapsule(capsule);
      const ownedTask = input.taskId && input.parentSessionId
        ? await new TaskRegistry(createSessionTaskStore(inheritedTaskScope?.ownerSessionId ?? input.parentSessionId)).getTask(input.taskId)
        : null;
      let closureNote = '';
      if (input.parentSessionId) {
        let grantedRefs = delegationCapsuleArtifactRefs(frozenCapsule);
        if (ownedTask?.executionRequirements?.independentOfTaskIds.length) {
          // An independent review reads only what it is granted; add what the granted records depend on.
          const parentGrant = delegatedArtifactReferences(input.parentSessionId);
          const parentRefs = parentGrant ? new Set(parentGrant.map(ref => ref.uri)) : null;
          try {
            const closure = reviewEvidenceClosure(investigationArtifactService,
              delegatedArtifactOwner(input.parentSessionId) ?? input.parentSessionId, grantedRefs,
              uri => !parentRefs || parentRefs.has(uri));
            closureNote = closure.refs.length > grantedRefs.length || closure.omitted.length
              ? `Runtime evidence closure: ${closure.refs.length - grantedRefs.length} dependent record or raw artifact reference(s) were added to the grant.`
                + (closure.omitted.length ? ` Not granted: ${closure.omitted.map(item => `${item.uri} (${item.reason})`).join(', ')}.` : '') + '\n'
              : '';
            grantedRefs = closure.refs;
          } catch (error) {
            closureNote = `Runtime evidence closure unavailable: ${error instanceof Error ? error.message : String(error)}. Only the explicitly granted references are readable.\n`;
          }
        }
        try {
          releaseArtifacts = grantDelegatedArtifactAccess(subagentSessionId, input.parentSessionId, grantedRefs);
        } catch (error) {
          if (error instanceof SessionArtifactError && error.code === 'ARTIFACT_NOT_FOUND') {
            sourceFailure = { code: error.code, message: error.message };
          }
          throw error;
        }
      } else if (frozenCapsule.inputArtifactRefs.length || frozenCapsule.challengeRefs.length || frozenCapsule.acceptedFacts.some(fact => fact.sourceRefs.length)) {
        throw new AppError('ARTIFACT_SESSION_DENIED', 'delegation references require a parent session.');
      }
      const taskContract = ownedTask ? '\nRuntime Task completion contract (output keys, not source instructions): ' + JSON.stringify({
        taskId: ownedTask.id, completionRequirements: ownedTask.completionRequirements,
        rule: 'Return every completionRequirements string verbatim as a key in turn_complete.result.outputs. Values are complete strings. Runtime persists the result; do not invent its reference.',
      }) : '';
      const artifactReferences = delegatedArtifactReferences(subagentSessionId) ?? [];
      const artifactInput = artifactReferences.length
        ? `Runtime-frozen artifact references (URI, SHA-256):\n${artifactReferences.map(ref => `${ref.uri} ${ref.hash}`).join('\n')}\n`
        : '';
      const childInput = artifactInput + closureNote + renderDelegationCapsuleInput(frozenCapsule) + taskContract;
      if (ownerSessionId) delegationTraceStore.updateTask(ownerSessionId, input.parentToolCallId, traceIdentity,
        { capsule: frozenCapsule, completionRequirements: ownedTask?.completionRequirements ?? [] },
        childInput);
      const capsuleSegments = [...compileDelegationCapsule(frozenCapsule), ...rdcDelegation.segments];
      if (rdcDelegation.requiresLease) {
        if (!input.parentSessionId?.trim()) {
          throw new AppError('RDC_LEASE_DELEGATE_DENIED', 'RDC capability requested but no parent session.');
        }
        const ownerTurnId = input.parentTurn?.turnId?.trim() ?? '';
        if (!ownerTurnId) {
          throw new AppError('RDC_LEASE_DELEGATE_DENIED', 'RDC capability requested but parent turn id is missing.');
        }
        grantDelegatedLease({
          parentSessionId: input.parentSessionId,
          childSessionId: subagentSessionId,
          ...(input.projectId ? { projectId: input.projectId } : {}),
          ownerTurnId,
        });
      }
      childPromise = withDelegatedInteractionOwner({ ownerSessionId: input.parentSessionId ?? subagentSessionId, childSessionId: subagentSessionId, executionId: input.executionId ?? subagentId }, () => this.profileTurns.runChildTurn(
        {
          agentId: input.targetProfile,
          content: childInput,
          sessionId: subagentSessionId,
          projectRootPath: input.projectRootPath,
          projectId: input.projectId,
          systemPrompt,
          effectiveProfile: definition ?? null,
          effectiveProfileIds,
          signal: childAbort.signal,
          policyBudget: childPolicyBudget,
          subagentBudget: childBudget,
          // This is the resolved child Agent's frozen route, not a parent-supplied override.
          modelOverride: { providerId: definition.compiledRoute!.providerId, modelId: definition.compiledRoute!.modelId },
          ...(definition.reasoningLevel ? { turnControls: { reasoningLevel: definition.reasoningLevel, maxContextMode: false, fastModel: false } } : {}),
          extraPromptSegments: capsuleSegments,
          frozenDelegationCapsule: frozenCapsule,
          preloadSkillIds: frozenCapsule.requiredSkillIds,
          onTaskPreparation: async (preparation) => {
            if (ownedTask && input.executionId && input.taskExecutionGeneration !== undefined) {
              const capsuleHash = createHash('sha256').update(JSON.stringify(frozenCapsule)).digest('hex');
              if (preparation.capsuleHash !== capsuleHash) throw new AppError('TASK_EXECUTION_REQUIREMENTS', 'prepared Capsule differs from dispatched work.');
              await new TaskRegistry(createSessionTaskStore(inheritedTaskScope?.ownerSessionId ?? input.parentSessionId!))
                .bindExecutionPreparation(input.executionId, input.taskExecutionGeneration, preparation);
            }
            if (ownerSessionId && preparation.providerId && preparation.modelId && preparation.reasoningLevel) {
              delegationTraceStore.setPreparedRoute(ownerSessionId, input.parentToolCallId, traceIdentity, {
                providerId: preparation.providerId, modelId: preparation.modelId, reasoningLevel: preparation.reasoningLevel,
              });
            }
          },
          beforeProviderRequestMessages: input.beforeProviderRequestMessages,
          onProviderRequestCommitted: input.onProviderRequestCommitted,
          excludeRdcLeaseTools: !rdcDelegation.requiresLease,
          onTerminalContext: (terminal) => { completionDeclaration = terminal.completionDeclaration ?? null; },
          onEvent: (event: AgentEvent) => {
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
              const completed = event.payload;
              if (completed.toolName === 'subagent' && completed.toolCallId) {
                delegationTraceStore.setParentReceipt(ownerSessionId, completed.toolCallId, completed.result);
              }
            }
            if (event.type === 'tool.started' || event.type === 'tool.completed' || event.type === 'tool.denied') {
              const toolCallId = event.payload.toolCallId.trim();
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
        const reason = childAbort.signal.reason;
        if (reason instanceof Error && reason.message.startsWith('POLICY_LIMIT_EXCEEDED: maxWallTimeMs')) {
          resultText = reason.message;
        }
      }
    } catch (error) {
      const aborted = childAbort.signal.aborted
        || (error instanceof Error && error.name === 'AbortError');
      resultStatus = aborted ? 'cancelled' : 'failed';
      if (!aborted && error instanceof DelegationConfigurationError) configurationError = error.code;
      const reason = childAbort.signal.reason;
      resultText = aborted && reason instanceof Error && reason.message.startsWith('POLICY_LIMIT_EXCEEDED: maxWallTimeMs')
        ? reason.message
        : error instanceof Error ? error.message : String(error);
    } finally {
      try {
        if (deadlineTimer) clearTimeout(deadlineTimer);
        await processSupervisor.joinExecutionProcesses(subagentSessionId);
        const lease = getRdcContextLease(subagentSessionId);
        revokeDelegatedLease(subagentSessionId, { operationStopped: !!lease && !shellInvocationService.hasUnconfirmedProcesses(lease.contextId) });
        releaseArtifacts?.();
        releaseTaskScope?.();
        if (isTransientScopeId(subagentSessionId)) releaseScopeTaskStore(subagentSessionId);
        unregisterProducer?.();
        if (parentSignal) {
          parentSignal.removeEventListener('abort', onParentAbort);
        }
        // Propagate child budget usage back to parent.
        parentBudget.aggregateToolCalls = Math.max(
          parentBudget.aggregateToolCalls,
          childBudget.aggregateToolCalls,
        );
      } finally {
        finishSubagentBudgetChild(parentBudget);
        finishLifecycle();
      }
    }

    if (ownerSessionId) delegationTraceStore.finish(ownerSessionId, input.parentToolCallId, traceIdentity, resultStatus, resultText, configurationError);

    return { text: resultText, status: resultStatus, subagentId, policyBudget: childPolicyBudget, completionDeclaration,
      ...(resultStatus === 'failed' && sourceFailure ? { sourceFailure } : {}) };
  }

  createSubagentTools(parentAgentId: AgentRole, sessionId?: string | null, turnHandle?: TurnHandle | null): AgentTool[] {
    return createSubagentTools(this, parentAgentId, sessionId, turnHandle);
  }
}
