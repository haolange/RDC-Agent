/**
 * ToolCallAdmission — the gates a model tool call passes before permission review:
 * runtime allowlist, frozen Skill intersection, policy, deferred activation, budget,
 * argument validation and live-capture access. Behaviour comes from the declared
 * `AgentTool.spec`, never from the tool name.
 */

import { toolToDefinition } from '../agent/AgentTool';
import { isToolDeniedByPolicy } from '../permissions/PolicyCompiler';
import { ToolValidationError, toolValidator } from '../core/ToolValidator';
import { APPROVED_CAPTURE_SCOPE_REQUIRED, reserveDispatchBudget, type TurnHandle } from './TurnCoordinator';
import { normalizeToolName } from './RuntimeToolPolicy';
import { isDeferredToolName } from './deferredTools';
import type { ActiveTurnLookup, ToolExecutorRuntimeContext } from './orchestratorTypes';
import type { AgentSlotRegistry } from './AgentSlotRegistry';
import type { EffectiveRuntimePlan } from '../EffectiveRuntimePlan';
import type { AgentTool } from '../agent/AgentTool';
import type { ToolCallContent, ToolResultMessage } from '../core/types';
import type { ToolCall } from '@shared/types/tool';
import type { AgentRole } from '@shared/types/agent';

/** The runtime allowlist checks a call passes before permission review (RuntimeToolAssembly). */
export interface RuntimeToolPolicyCheck {
  isAllowedForRuntime(
    agentId: AgentRole,
    toolName: string,
    frozenToolAllowlist?: readonly string[],
    excludeRdcLeaseTools?: boolean,
  ): boolean;
  matchesToolAllowlist(toolName: string, toolAllowlist: string[]): boolean;
}

export interface ToolCallAdmissionDeps {
  slots: AgentSlotRegistry;
  activeTurns: ActiveTurnLookup;
  toolPolicy: RuntimeToolPolicyCheck;
}

/** Facts one executor freezes when it is created and applies to every call it mediates. */
export interface ToolExecutorScope {
  agentId: AgentRole;
  sessionId: string | null | undefined;
  runtimeContext: ToolExecutorRuntimeContext | undefined;
  plan: EffectiveRuntimePlan | undefined;
  effectiveToolAllowlist: string[];
  tools: Map<string, AgentTool>;
  /** Frozen on prepareTurn; skill_read does not re-narrow mid-turn. */
  activeSkillAllowlist: Set<string> | null;
  planActivatedDeferredTools: Set<string>;
  /** Calls whose dispatch budget was reserved with their group. */
  reservedCallIds: Set<string>;
}

/** One call that passed admission and argument validation. */
export interface ValidatedToolCall {
  toolCall: ToolCallContent;
  tool: AgentTool;
  args: Record<string, unknown>;
}

export type DenyTool = (reason?: string) => Promise<ToolResultMessage>;
export type AdmissionGate<T> =
  { ok: true; value: T } | { ok: false; result: ToolResultMessage | Promise<ToolResultMessage> };

export function errorToolResult(toolCall: ToolCall, text: string): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: 'text', text }],
    isError: true,
    timestamp: Date.now(),
  };
}

/** Runtime allowlist, frozen Skill intersection, policy and deferred activation, in that order. */
export function admitToolCall(
  deps: ToolCallAdmissionDeps,
  scope: ToolExecutorScope,
  toolCall: ToolCall,
  denyTool: DenyTool,
): AdmissionGate<AgentTool> {
  const { agentId, plan, runtimeContext } = scope;
  const normalizedName = normalizeToolName(toolCall.name);
  if (
    !deps.toolPolicy.isAllowedForRuntime(
      agentId,
      toolCall.name,
      scope.effectiveToolAllowlist,
      plan?.excludeRdcLeaseTools === true,
    ) ||
    !scope.tools.has(normalizedName)
  ) {
    return { ok: false, result: denyTool() };
  }
  if (
    scope.activeSkillAllowlist !== null &&
    !deps.toolPolicy.matchesToolAllowlist(normalizedName, Array.from(scope.activeSkillAllowlist))
  ) {
    return {
      ok: false,
      result: denyTool(`Tool "${toolCall.name}" is outside the allowed-tools set declared by the active skill.`),
    };
  }
  if (plan?.policy && isToolDeniedByPolicy(plan.policy, normalizedName)) {
    return { ok: false, result: denyTool(`POLICY_DENIED: tool "${toolCall.name}" is in deniedTools.`) };
  }
  if (isDeferredToolName(normalizedName)) {
    const activation = deps.activeTurns.getActiveTurn(runtimeContext?.sessionId)?.deferredActivation ?? null;
    const slot = activation ? deps.slots.getSlot(activation.slotKey) : undefined;
    const activatedByFrozenPlan = scope.planActivatedDeferredTools.has(normalizedName);
    const activatedDuringTurn = slot?.activatedDeferredTools.has(normalizedName) === true;
    if (!activatedByFrozenPlan && !activatedDuringTurn) {
      return { ok: false, result: errorToolResult(toolCall, 'TOOL_NOT_ACTIVATED: Use tool_search first.') };
    }
  }
  const tool = scope.tools.get(normalizedName);
  if (!tool) {
    return { ok: false, result: denyTool() };
  }
  return { ok: true, value: tool };
}

/** A call not reserved with its group reserves itself; returns the exhausted limit, if any. */
export function reserveCallBudget(scope: ToolExecutorScope, toolCall: ToolCall): string | null {
  const policyBudget = scope.runtimeContext?.policyBudget;
  const alreadyReserved = scope.reservedCallIds.delete(toolCall.id);
  if (policyBudget && !alreadyReserved) {
    const reserved = reserveDispatchBudget(policyBudget, { toolCalls: 1, subagents: 0 });
    if (!reserved.ok) return reserved.limit;
  }
  return null;
}

export function validateToolArguments(
  tool: AgentTool,
  toolCall: ToolCallContent,
): AdmissionGate<Record<string, unknown>> {
  if (toolCall.invalidArguments !== undefined) {
    return {
      ok: false,
      result: errorToolResult(
        toolCall,
        `TOOL_ARGUMENTS_INVALID: the arguments were not a JSON object. Received: ${toolCall.invalidArguments.slice(0, 200)}`,
      ),
    };
  }
  try {
    const validatedArgs = toolValidator.validate(toolToDefinition(tool), toolCall.arguments);
    tool.validateArgs?.(validatedArgs);
    return { ok: true, value: validatedArgs };
  } catch (error) {
    const message =
      error instanceof ToolValidationError ? error.message : error instanceof Error ? error.message : String(error);
    return { ok: false, result: errorToolResult(toolCall, `TOOL_SCHEMA_VIOLATION: ${message}`) };
  }
}

/** Live capture work needs a plan-frozen scope in an approved execution and the controller's live access. */
export function captureAccessDenial(call: ValidatedToolCall, activeTurn: TurnHandle | null): string | null {
  const capture = call.tool.spec.capture;
  if (!capture) return null;
  if (activeTurn?.requiresApprovedCaptureScope && capture.requiresApprovedScope(call.args)) {
    return APPROVED_CAPTURE_SCOPE_REQUIRED;
  }
  const captureControl = activeTurn?.captureControl;
  if (captureControl && capture.live(call.args)) {
    try {
      captureControl.assertLiveAccess();
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }
  return null;
}
