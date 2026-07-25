/**
 * SubagentRunner — serial isolated sub-agent turns and subagent tool.
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
import {
  assertSubagentBudgetAllowsChild,
  createSubagentBudgetState,
  type SubagentResultStatus,
  type TurnHandle,
} from './TurnCoordinator';
import type { AgentProfileTurnOptions } from './orchestratorTypes';

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
    task: string;
    parentSessionId?: string | null;
    parentOnEvent?: (event: SharedAgentEvent) => void;
    projectRootPath?: string | null;
    projectId?: string | null;
    parentTurn?: TurnHandle | null;
    signal?: AbortSignal | null;
  }): Promise<{ text: string; status: SubagentResultStatus; subagentId: string }> {
    const parentBudget = input.parentTurn?.subagentBudget ?? createSubagentBudgetState();
    assertSubagentBudgetAllowsChild(parentBudget);
    parentBudget.childrenSpawned += 1;

    const subagentId = generateEventId('subagent');
    // 子 agent 用独立 sessionId 段隔离 context/messages（不污染父线程持久化）。
    const subagentSessionId = input.parentSessionId
      ? `${input.parentSessionId}::subagent::${subagentId}`
      : null;

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
        text: input.task,
      } satisfies AgentSubagentEventPayload,
    });

    // 组装子 agent system prompt（目标 profile instructions）
    const definition = settingsService.getAll().agents.definitions
      .find((d) => d.id === input.targetProfile && d.enabled);
    const systemPrompt = definition?.instructions?.trim()
      || this.deps.systemPromptForAgent(input.targetProfile);

    let resultText = '';
    let resultStatus: SubagentResultStatus = 'complete';
    const childBudget = createSubagentBudgetState(parentBudget.budget, parentBudget.depth + 1);
    childBudget.aggregateToolCalls = parentBudget.aggregateToolCalls;
    childBudget.wallStartedAt = parentBudget.wallStartedAt;

    const unregisterProducer = input.parentTurn?.registerProducer({
      id: subagentId,
      abort: () => onParentAbort(),
      join: async () => {
        // Child turn join is awaited via sendProfileMessage completion below.
      },
    });

    try {
      if (childAbort.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      resultText = await this.deps.sendProfileMessage(
        input.targetProfile,
        input.task,
        {
          sessionId: subagentSessionId ?? undefined,
          stage: 'investigate',
          projectRootPath: input.projectRootPath,
          projectId: input.projectId,
          systemPrompt,
          signal: childAbort.signal,
          onEvent: (event: SharedAgentEvent) => {
            if (input.parentTurn && !input.parentTurn.isLive(input.parentTurn.generation)) {
              return;
            }
            if (event.type === 'tool.started' || event.type === 'tool.completed' || event.type === 'tool.denied') {
              parentBudget.aggregateToolCalls += 1;
              childBudget.aggregateToolCalls = parentBudget.aggregateToolCalls;
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
      { task: string; profile?: string },
      { subagentId: string; profile: string; status: string }
    > = {
      name: 'subagent',
      label: 'Subagent',
      description: 'Delegate a sub-task to an isolated sub-agent. The sub-agent runs to completion (serial, not parallel) and returns its final answer. Use profile to target a specific agent profile (defaults to "ask" read-only).',
      parameters: {
        type: 'object',
        required: ['task'],
        properties: {
          task: { type: 'string', description: 'The task description for the sub-agent.' },
          profile: { type: 'string', description: 'Target profile id. Defaults to "ask" (read-only).' },
        },
      },
      permissionHint: 'readonly',
      async execute(toolCallId, args, signal) {
        const targetProfile = (typeof args.profile === 'string' && args.profile.trim() ? args.profile.trim() : 'ask') as AgentRole;
        const turn = capturedTurn ?? getActiveTurn(sessionId);
        const result = await runSubagent({
          parentAgentId,
          parentToolCallId: toolCallId,
          targetProfile,
          task: args.task,
          parentSessionId: sessionId ?? null,
          parentOnEvent: turn?.eventSink?.onEvent,
          projectRootPath: turn?.eventSink?.projectRootPath ?? null,
          projectId: turn?.eventSink?.projectId ?? null,
          parentTurn: turn,
          signal: signal ?? turn?.signal ?? null,
        });
        return {
          content: [{ type: 'text', text: result.text || '(sub-agent returned empty output)' }],
          details: { subagentId: result.subagentId, profile: targetProfile, status: result.status },
        };
      },
    };

    return [runSubagentTool];
  }
}
