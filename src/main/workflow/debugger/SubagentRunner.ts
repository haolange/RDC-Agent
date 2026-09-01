/**
 * SubagentRunner — isolated sub-agent turns and the subagent tool.
 * Capsule fields are required. Offline children (requiresRdxLease=false) may
 * join a consecutive concurrency-safe group; lease-holding children are serial.
 */

import type { AgentRole } from '@shared/types/agent';
import type {
  AgentEvent as SharedAgentEvent,
  AgentAssistantDeltaPayload,
  AgentSubagentEventPayload,
} from '@shared/types/agentRuntime';
import { generateEventId, nowMs } from '@shared/utils/id';
import type { AgentTool } from '../../agent-runtime/agent/AgentTool';
import { settingsService } from '../../settings/SettingsService';
import { agentManifestService } from '../../settings/AgentManifestService';
import {
  assertSubagentBudgetAllowsChild,
  consumeReservedSubagentSlot,
  createSubagentBudgetState,
  type SubagentResultStatus,
  type TurnHandle,
} from './TurnCoordinator';
import type { AgentProfileTurnOptions } from './orchestratorTypes';
import { createEphemeralScopeId } from './executionScope';
import { resolveSubagentModelOverride } from './subagentModelArg';
import {
  DELEGATION_CAPSULE_JSON_SCHEMA,
  parseDelegationCapsule,
  type DelegationCapsule,
} from '@shared/types/delegationCapsule';
import { compileDelegationCapsule } from '../../agent-runtime/prompt/DelegationCapsuleCompiler';

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
  constructor(private readonly deps: SubagentRunnerDeps) {}

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
    signal?: AbortSignal | null;
    model?: string;
  }): Promise<{ text: string; status: SubagentResultStatus; subagentId: string }> {
    const capsule = input.capsule;
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
      return {
        text: error instanceof Error ? error.message : String(error),
        status: 'failed',
        subagentId: generateEventId('subagent'),
      };
    }
    const effectiveProfileIds = effectiveProfiles.filter((entry) => entry.enabled).map((entry) => entry.id);
    const systemPrompt = definition.instructions?.trim() || this.deps.systemPromptForAgent(input.targetProfile);

    const parentBudget = input.parentTurn?.subagentBudget ?? createSubagentBudgetState();
    assertSubagentBudgetAllowsChild(parentBudget);
    const policyBudget = input.parentTurn?.policyBudget;
    const prepaid = consumeReservedSubagentSlot(policyBudget);
    if (policyBudget && !prepaid) {
      if (Date.now() - policyBudget.wallStartedAt >= policyBudget.maxWallTimeMs) {
        throw new Error(`POLICY_LIMIT_EXCEEDED: maxWallTimeMs ${policyBudget.maxWallTimeMs}.`);
      }
      if (input.parentTurn && input.parentTurn.subagentBudget.depth >= policyBudget.maxChildDepth) {
        throw new Error(`POLICY_LIMIT_EXCEEDED: maxChildDepth ${policyBudget.maxChildDepth}.`);
      }
      if (policyBudget.subagents >= policyBudget.maxSubagents) {
        throw new Error(`POLICY_LIMIT_EXCEEDED: maxSubagents ${policyBudget.maxSubagents}.`);
      }
      policyBudget.subagents += 1;
    }
    parentBudget.childrenSpawned += 1;

    const subagentId = generateEventId('subagent');
    // 子 agent 用独立 sessionId 段隔离 context/messages（不污染父线程持久化）。
    const subagentSessionId = input.parentSessionId
      ? `${input.parentSessionId}::subagent::${subagentId}`
      : createEphemeralScopeId();

    const childAbort = new AbortController();
    const parentSignal = input.signal ?? input.parentTurn?.signal ?? null;
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

    // 通知父 trace：子 agent 启动
    input.parentOnEvent?.({
      id: generateEventId('agent-event'),
      type: 'subagent.started',
      timestamp: nowMs(),
      sessionId: input.parentSessionId ?? null,
      agentId: input.parentAgentId,
      payload: {
        subagentId,
        profile: input.targetProfile,
        parentToolCallId: input.parentToolCallId,
        text: task,
      } satisfies AgentSubagentEventPayload,
    });

    // 组装子 agent system prompt（目标 profile instructions）
    let resultText = '';
    let resultStatus: SubagentResultStatus = 'complete';
    let childPromise: Promise<string> | null = null;
    const seenToolCallIds = new Set<string>();
    const childBudget = createSubagentBudgetState({
      ...parentBudget.budget,
      maxDepth: policyBudget?.maxChildDepth ?? parentBudget.budget.maxDepth,
      maxChildren: policyBudget?.maxSubagents ?? parentBudget.budget.maxChildren,
      maxAggregateToolCalls: policyBudget?.maxToolCalls ?? parentBudget.budget.maxAggregateToolCalls,
    }, parentBudget.depth + 1);
    childBudget.aggregateToolCalls = parentBudget.aggregateToolCalls;
    childBudget.wallStartedAt = parentBudget.wallStartedAt;

    const unregisterProducer = input.parentTurn?.registerProducer({
      id: subagentId,
      abort: () => onParentAbort(),
      join: async () => {
        if (childPromise) await childPromise.catch(() => undefined);
      },
    });

    try {
      if (childAbort.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const capsuleSegments = compileDelegationCapsule(capsule);
      childPromise = this.deps.sendProfileMessage(
        input.targetProfile,
        task,
        {
          sessionId: subagentSessionId,
          stage: 'investigate',
          projectRootPath: input.projectRootPath,
          projectId: input.projectId,
          systemPrompt,
          effectiveProfile: definition ?? null,
          effectiveProfileIds,
          signal: childAbort.signal,
          policyBudget,
          subagentBudget: childBudget,
          modelOverride: modelOverride ?? null,
          extraPromptSegments: capsuleSegments,
          onEvent: (event: SharedAgentEvent) => {
            if (input.parentTurn && !input.parentTurn.isLive(input.parentTurn.generation)) {
              return;
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
            const basePayload = {
              subagentId,
              profile: input.targetProfile,
              parentToolCallId: input.parentToolCallId,
            } satisfies Pick<AgentSubagentEventPayload, 'subagentId' | 'profile' | 'parentToolCallId'>;

            if (event.type === 'assistant.delta') {
              const delta = event.payload as AgentAssistantDeltaPayload;
              if (delta.text) {
                input.parentOnEvent?.({
                  id: generateEventId('agent-event'),
                  type: 'subagent.delta',
                  timestamp: nowMs(),
                  sessionId: input.parentSessionId ?? null,
                  agentId: input.parentAgentId,
                  payload: {
                    ...basePayload,
                    text: delta.text,
                  } satisfies AgentSubagentEventPayload,
                });
              }
              return;
            }

            if (event.type === 'tool.started') {
              const payload = event.payload as { toolCallId?: string; toolName?: string };
              input.parentOnEvent?.({
                id: generateEventId('agent-event'),
                type: 'subagent.delta',
                timestamp: nowMs(),
                sessionId: input.parentSessionId ?? null,
                agentId: input.parentAgentId,
                payload: {
                  ...basePayload,
                  child: {
                    id: String(payload.toolCallId ?? generateEventId('subagent-tool')),
                    kind: 'tool',
                    title: payload.toolName ? `Tool: ${payload.toolName}` : 'Tool',
                    status: 'running',
                    toolName: payload.toolName,
                  },
                } satisfies AgentSubagentEventPayload,
              });
              return;
            }

            if (event.type === 'tool.completed' || event.type === 'tool.denied') {
              const payload = event.payload as {
                toolCallId?: string;
                toolName?: string;
                result?: { ok?: boolean; error?: { message?: string } };
                reason?: string;
              };
              const failed = event.type === 'tool.denied' || payload.result?.ok === false;
              const summary = failed
                ? (payload.reason || payload.result?.error?.message || 'Tool failed')
                : 'Tool completed';
              input.parentOnEvent?.({
                id: generateEventId('agent-event'),
                type: 'subagent.delta',
                timestamp: nowMs(),
                sessionId: input.parentSessionId ?? null,
                agentId: input.parentAgentId,
                payload: {
                  ...basePayload,
                  child: {
                    id: String(payload.toolCallId ?? generateEventId('subagent-tool')),
                    kind: 'tool',
                    title: payload.toolName ? `Tool: ${payload.toolName}` : 'Tool',
                    status: failed ? 'error' : 'complete',
                    toolName: payload.toolName,
                    summary,
                  },
                } satisfies AgentSubagentEventPayload,
              });
            }
          },
        },
      );
      resultText = await childPromise;
      if (childAbort.signal.aborted) {
        resultStatus = 'cancelled';
      }
    } catch (error) {
      const aborted = childAbort.signal.aborted
        || (error instanceof Error && (error.name === 'AbortError' || /abort|cancel/i.test(error.message)));
      resultStatus = aborted ? 'cancelled' : 'failed';
      resultText = error instanceof Error ? error.message : String(error);
    } finally {
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

    // 通知父 trace：子 agent 完成
    input.parentOnEvent?.({
      id: generateEventId('agent-event'),
      type: 'subagent.completed',
      timestamp: nowMs(),
      sessionId: input.parentSessionId ?? null,
      agentId: input.parentAgentId,
      payload: {
        subagentId,
        profile: input.targetProfile,
        parentToolCallId: input.parentToolCallId,
        text: resultText,
        status: resultStatus,
      } satisfies AgentSubagentEventPayload,
    });

    return { text: resultText, status: resultStatus, subagentId };
  }

  createSubagentTools(parentAgentId: AgentRole, sessionId?: string | null, turnHandle?: TurnHandle | null): AgentTool[] {
    const getActiveTurn = this.deps.getActiveTurn;
    const runSubagent = this.runSubagent.bind(this);
    const capturedTurn = turnHandle ?? getActiveTurn(sessionId);
    const runSubagentTool: AgentTool<
      Record<string, unknown>,
      { subagentId: string; profile: string; status: string }
    > = {
      name: 'subagent',
      label: 'Subagent',
      description: 'Delegate a structured Delegation Capsule to an isolated sub-agent. Required fields: mission, task, acceptedFacts, forbiddenPaths, inputArtifactRefs, outputRequirements, budget, requiresRdxLease. Offline children set requiresRdxLease=false and may join a concurrent group; lease-holding children are serial. Optional model is a canonical providerId:modelId and does not inherit the parent session override.',
      parameters: DELEGATION_CAPSULE_JSON_SCHEMA as unknown as AgentTool['parameters'],
      permissionHint: 'readonly',
      spec: {
        isReadOnly: true,
        isConcurrencySafe: false,
        isDestructive: false,
        sideEffect: 'session',
        category: 'task',
        requiresApproval: false,
      },
      async execute(toolCallId, args, signal) {
        let capsule: DelegationCapsule;
        try {
          capsule = parseDelegationCapsule(args);
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
        const result = await runSubagent({
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
          signal: signal ?? turn?.signal ?? null,
        });
        return {
          content: [{ type: 'text', text: result.text || '(sub-agent returned empty output)' }],
          isError: result.status !== 'complete',
          details: {
            subagentId: result.subagentId,
            profile: targetProfile,
            status: result.status,
            errorCode: result.status === 'cancelled' ? 'SUBAGENT_CANCELLED' : result.status === 'failed' ? 'SUBAGENT_FAILED' : undefined,
          },
        };
      },
    };

    return [runSubagentTool];
  }
}
