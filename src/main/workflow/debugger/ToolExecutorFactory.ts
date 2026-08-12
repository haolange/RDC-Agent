/**
 * ToolExecutorFactory — createToolExecutor and tool-call mediation helpers.
 */

import type { AgentRole } from '@shared/types/agent';
import type { WorkflowStage } from '@shared/types/workflow';
import type { HookEvent } from '@shared/types/rdxRuntime';
import { normalizeAskUserQuestions } from '@shared/utils/askUser';
import type { AgentToolResult, ToolExecutionContext } from '../../agent-runtime/agent/AgentTool';
import { toolToDefinition } from '../../agent-runtime/agent/AgentTool';
import type { ToolExecutor } from '../../agent-runtime/agent/AgentLoop';
import type { ToolCall, ToolResultMessage } from '../../agent-runtime/core/types';
import { getWorkspaceRoot, withTemporaryPathAccess } from '../../agent-runtime/tools/primitives/_shared';
import { buildDiagnosticAgentEvent } from '../../agent-runtime/AgentEventBridge';
import { agentUserInputRequestService } from '../../agent-runtime/interactions/AgentUserInputRequestService';
import { agentPermissionPolicyService } from '../../agent-runtime/permissions/AgentPermissionPolicy';
import { agentToolApprovalRequestService } from '../../agent-runtime/permissions/AgentToolApprovalRequestService';
import { isToolDeniedByPolicy } from '../../agent-runtime/permissions/PolicyCompiler';
import { ToolValidationError, toolValidator } from '../../agent-runtime/core/ToolValidator';
import { hookEngine } from '../../hooks/HookEngine';
import { appPathService } from '../../runtime/AppPathService';
import { agentRuntimeConfigService } from '../../settings/AgentRuntimeConfigService';
import {
  extractDeferredToolNamesFromToolSearchDetails,
  isDeferredToolName,
} from './deferredTools';
import {
  intersectSkillAllowedTools,
  normalizeToolName,
} from './DebuggerRuntimePolicy';
import type { AgentSlotRegistry } from './AgentSlotRegistry';
import type { DeferredToolActivationTracker } from './DeferredToolActivationTracker';
import type { TurnHandle } from './TurnCoordinator';
import type { ResolvedRuntimeTools, ToolExecutorRuntimeContext } from './orchestratorTypes';

export interface ToolExecutorFactoryDeps {
  slots: AgentSlotRegistry;
  deferredActivation: DeferredToolActivationTracker;
  getActiveTurn: (sessionId?: string | null) => TurnHandle | null;
  resolveRuntimeTools: (
    agentId: AgentRole,
    toolAllowlist: string[],
    stage?: WorkflowStage | 'report',
    sessionId?: string | null,
    turnHandle?: TurnHandle | null,
    projectId?: string | null,
    projectRootPath?: string | null,
    mcpPoolKey?: string | null,
  ) => ResolvedRuntimeTools;
  isAllowedForRuntime: (
    agentId: AgentRole,
    toolName: string,
    stage?: WorkflowStage | 'report',
    frozenToolAllowlist?: readonly string[],
  ) => boolean;
  matchesToolAllowlist: (toolName: string, toolAllowlist: string[]) => boolean;
}

export class ToolExecutorFactory {
  constructor(private readonly deps: ToolExecutorFactoryDeps) {}

  activateDeferredTools(toolNames: string[], sessionId?: string | null): void {
    const activation = this.deps.getActiveTurn(sessionId)?.deferredActivation ?? null;
    if (!activation || toolNames.length === 0) {
      return;
    }
    const slot = this.deps.slots.getSlot(activation.slotKey);
    if (!slot) {
      return;
    }
    const { changed, injected } = this.deps.deferredActivation.activate({
      slotKey: activation.slotKey,
      toolNames,
      allDefinitions: activation.allDefinitions,
      activatedSet: slot.activatedDeferredTools,
    });
    if (!changed) {
      return;
    }
    // COW revision bump — next LLM round reads new activeTools via LoopRuntimeState.
    slot.agent.activateDeferredTools(slot.activatedDeferredTools, injected);
  }

  createToolExecutor(
    agentId: AgentRole,
    toolAllowlist: string[],
    stage?: WorkflowStage | 'report',
    sessionId?: string | null,
    runtimeContext?: ToolExecutorRuntimeContext,
  ): ToolExecutor {
    // 有 effectivePlan 时：permission / skills / policy / toolAllowlist 只读 plan，禁止 getAll。
    const plan = runtimeContext?.effectivePlan;
    const effectiveToolAllowlist = plan
      ? [...plan.toolAllowlist]
      : toolAllowlist;
    const tools = this.deps.resolveRuntimeTools(
      agentId,
      [...effectiveToolAllowlist],
      stage,
      sessionId,
      this.deps.getActiveTurn(sessionId),
      runtimeContext?.projectId ?? plan?.projectId,
      runtimeContext?.projectRootPath ?? plan?.projectRootPath,
      runtimeContext?.mcpPoolKey ?? null,
    ).toolMap;
    // Skill allowed-tools 收窄集（DESIGN Skills 条款：只收窄、不扩展）。
    // 多 skill：allowedTools = ∩(skill_i) ∩ runtimeAllowlist（空声明不参与）。
    let activeSkillAllowlist: Set<string> | null = plan?.skillIntersection
      ? new Set(plan.skillIntersection)
      : null;
    const applySkillNarrowing = (skillAllowedTools: string[]): void => {
      if (skillAllowedTools.length === 0) return;
      const narrowed = intersectSkillAllowedTools(effectiveToolAllowlist, skillAllowedTools);
      if (activeSkillAllowlist === null) {
        activeSkillAllowlist = new Set(narrowed);
        return;
      }
      // failure-class: security — intersect skills; do not union.
      activeSkillAllowlist = new Set(
        [...activeSkillAllowlist].filter((name) => narrowed.includes(name)),
      );
    };
    // 无 plan 时才从 settings 解析 preloaded skills；有 plan 则用冻结的 skillIntersection。
    const permissionSettings = plan?.permissionSettings;
    const compiledPolicy = plan?.policy;
    const planActivatedDeferredTools = new Set(plan?.activatedDeferredTools ?? []);
    return {
      execute: async (toolCall: ToolCall, signal?: AbortSignal, onUpdate?: (partialResult: unknown) => void) => {
        const normalizedName = normalizeToolName(toolCall.name);
        if (!this.deps.isAllowedForRuntime(agentId, toolCall.name, stage, effectiveToolAllowlist) || !tools.has(normalizedName)) {
          return this.createPolicyDeniedToolResult(toolCall, agentId);
        }
        if (
          activeSkillAllowlist !== null
          && !this.deps.matchesToolAllowlist(normalizedName, Array.from(activeSkillAllowlist))
        ) {
          return this.createPolicyDeniedToolResult(
            toolCall,
            agentId,
            `Tool "${toolCall.name}" is outside the allowed-tools set declared by the active skill.`,
          );
        }
        if (compiledPolicy && isToolDeniedByPolicy(compiledPolicy, normalizedName)) {
          return this.createPolicyDeniedToolResult(
            toolCall,
            agentId,
            `POLICY_DENIED: tool "${toolCall.name}" is in deniedTools.`,
          );
        }
        if (isDeferredToolName(normalizedName)) {
          const activation = this.deps.getActiveTurn(runtimeContext?.sessionId)?.deferredActivation ?? null;
          const slot = activation ? this.deps.slots.getSlot(activation.slotKey) : undefined;
          const activatedByFrozenPlan = planActivatedDeferredTools.has(normalizedName);
          const activatedDuringTurn = slot?.activatedDeferredTools.has(normalizedName) === true;
          if (!activatedByFrozenPlan && !activatedDuringTurn) {
            return {
              role: 'toolResult',
              toolCallId: toolCall.id,
              toolName: toolCall.name,
              content: [{ type: 'text', text: 'TOOL_NOT_ACTIVATED: Use tool_search first.' }],
              isError: true,
              timestamp: Date.now(),
            };
          }
        }
        const tool = tools.get(normalizedName);
        if (!tool) {
          return this.createPolicyDeniedToolResult(toolCall, agentId);
        }
        const policyBudget = runtimeContext?.policyBudget;
        if (policyBudget) {
          if (Date.now() - policyBudget.wallStartedAt >= policyBudget.maxWallTimeMs) {
            return this.createPolicyLimitToolResult(toolCall, agentId, 'maxWallTimeMs');
          }
          if (policyBudget.toolCalls >= policyBudget.maxToolCalls) {
            return this.createPolicyLimitToolResult(toolCall, agentId, 'maxToolCalls');
          }
          policyBudget.toolCalls += 1;
        }
        let validatedArgs: Record<string, unknown>;
        try {
          validatedArgs = toolValidator.validate(toolToDefinition(tool), toolCall.arguments ?? {});
        } catch (error) {
          const message = error instanceof ToolValidationError
            ? error.message
            : error instanceof Error ? error.message : String(error);
          return {
            role: 'toolResult',
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: [{ type: 'text', text: `TOOL_SCHEMA_VIOLATION: ${message}` }],
            isError: true,
            timestamp: Date.now(),
          };
        }
        const validatedToolCall: ToolCall = { ...toolCall, arguments: validatedArgs };
        if (normalizedName === 'ask_user') {
          return this.executeAskUserTool(validatedToolCall, agentId, runtimeContext, signal);
        }
        const permissionDecision = agentPermissionPolicyService.evaluate({
          tool,
          toolCall: validatedToolCall,
          projectRootPath: runtimeContext?.projectRootPath ?? plan?.projectRootPath ?? null,
          ...(permissionSettings ? { permissionSettings } : {}),
          ...(compiledPolicy ? { compiledPolicy } : {}),
        });
        if (permissionDecision.action === 'deny') {
          return this.createPolicyDeniedToolResult(toolCall, agentId, permissionDecision.reason);
        }
        if (permissionDecision.action === 'ask_user') {
          if (!runtimeContext?.eventContext || !runtimeContext.turnId) {
            return this.createApprovalRequiredToolResult(toolCall, agentId, permissionDecision.reason ?? 'Tool approval requires an active conversation turn.');
          }
          const approved = await agentToolApprovalRequestService.request({
            agentId,
            sessionId: runtimeContext.sessionId ?? null,
            turnId: runtimeContext.turnId,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            reason: permissionDecision.reason ?? `Tool "${toolCall.name}" requires approval.`,
            risk: permissionDecision.risk,
            context: runtimeContext.eventContext,
            onEvent: runtimeContext.onEvent,
            signal,
          });
          if (!approved) {
            return this.createPolicyDeniedToolResult(toolCall, agentId, 'User denied this tool call.');
          }
        }
        if (permissionDecision.action === 'auto_review') {
          if (!runtimeContext?.eventContext || !runtimeContext.turnId) {
            return this.createPolicyDeniedToolResult(toolCall, agentId, 'Auto-review requires an active conversation turn.');
          }
          const approved = agentToolApprovalRequestService.autoReview({
            agentId,
            sessionId: runtimeContext.sessionId ?? null,
            turnId: runtimeContext.turnId,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            reason: permissionDecision.reason ?? `Tool "${toolCall.name}" requires review.`,
            risk: permissionDecision.risk,
            context: runtimeContext.eventContext,
            onEvent: runtimeContext.onEvent,
            signal,
          });
          if (!approved) {
            return this.createPolicyDeniedToolResult(toolCall, agentId, 'Auto-review denied this tool call.');
          }
        }
        try {
          const projectRootPath = runtimeContext?.projectRootPath ?? plan?.projectRootPath ?? null;
          const beforeHooksAllowed = await this.triggerRuntimeHooks('tool.before-call', agentId, runtimeContext, {
            toolName: toolCall.name,
            toolCallId: toolCall.id,
            arguments: validatedArgs,
          });
          if (!beforeHooksAllowed) {
            return this.createPolicyDeniedToolResult(toolCall, agentId, 'A blocking lifecycle hook denied this tool call.');
          }
          const toolContext: ToolExecutionContext = {
            workspaceRoot: projectRootPath ?? getWorkspaceRoot(),
            projectRootPath,
            projectId: runtimeContext?.projectId ?? plan?.projectId ?? null,
            sessionId: runtimeContext?.sessionId ?? null,
          };
          const result = await withTemporaryPathAccess(
            toolContext,
            permissionDecision.temporaryPathRoots,
            (scopedContext) => tool.execute(
              toolCall.id,
              validatedArgs,
              signal,
              onUpdate,
              scopedContext,
            ),
          );
          await this.triggerRuntimeHooks('tool.after-call', agentId, runtimeContext, {
            toolName: toolCall.name,
            toolCallId: toolCall.id,
            isError: result.isError === true,
          });
          // Deferred 激活：仅 tool_search 可激活；直接调用未激活 deferred → 上文已 fail-closed。
          if (normalizedName === 'tool_search' && result.isError !== true) {
            this.activateDeferredTools(
              extractDeferredToolNamesFromToolSearchDetails(result.details),
              runtimeContext?.sessionId,
            );
          }
          // Skill 激活：skill_read 成功后按其 allowed-tools 收窄本 turn 工具面。
          if (normalizedName === 'skill_read' && result.isError !== true) {
            const skillId = (result.details as { skillId?: string } | undefined)?.skillId;
            const skill = skillId
              ? agentRuntimeConfigService.loadSkill(skillId, projectRootPath ?? undefined)
              : null;
            if (skill?.allowedTools?.length) {
              applySkillNarrowing(skill.allowedTools);
            }
          }
          return this.agentToolResultToMessage(toolCall, result);
        } catch (error) {
          await this.triggerRuntimeHooks('tool.on-error', agentId, runtimeContext, {
            toolName: toolCall.name,
            toolCallId: toolCall.id,
            error: error instanceof Error ? error.message : String(error),
          });
          return {
            role: 'toolResult',
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
            isError: true,
            timestamp: Date.now(),
          };
        }
      },
    };
  }

  async triggerRuntimeHooks(
    event: HookEvent,
    agentId: AgentRole,
    runtimeContext: ToolExecutorRuntimeContext | undefined,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const projectRoot = runtimeContext?.projectRootPath ?? undefined;
    hookEngine.load(appPathService.getUserRdxPaths().hooksPath, projectRoot ?? undefined);
    const results = await hookEngine.trigger(event, {
      event,
      agentId,
      toolName: typeof payload.toolName === 'string' ? payload.toolName : undefined,
      sessionId: runtimeContext?.sessionId ?? undefined,
      projectRoot: projectRoot ?? undefined,
      payload,
    });
    for (const result of results) {
      if (!runtimeContext?.eventContext || !runtimeContext.onEvent) continue;
      runtimeContext.onEvent(buildDiagnosticAgentEvent(runtimeContext.eventContext, {
        code: `hook.${result.status}`,
        severity: result.status === 'completed' ? 'info' : result.allowed ? 'warning' : 'error',
        message: `Hook ${result.hookId}: ${result.status}`,
        technicalMessage: JSON.stringify({
          exitCode: result.exitCode,
          reason: result.reason,
          stdout: result.stdout,
          stderr: result.stderr,
        }),
      }));
    }
    return results.every((result) => result.allowed);
  }

  async executeAskUserTool(
    toolCall: ToolCall,
    agentId: AgentRole,
    runtimeContext: ToolExecutorRuntimeContext | undefined,
    signal?: AbortSignal,
  ): Promise<ToolResultMessage> {
    try {
      const args = toolCall.arguments ?? {};
      const questions = normalizeAskUserQuestions(args);
      if (questions.length === 0) {
        throw new Error('ask_user requires at least one canonical questions[] entry with a prompt.');
      }

      if (!runtimeContext?.eventContext || !runtimeContext.turnId) {
        throw new Error('ask_user requires an active conversation interaction bridge.');
      }

      const answer = await agentUserInputRequestService.request({
        agentId,
        sessionId: runtimeContext.sessionId ?? null,
        turnId: runtimeContext.turnId,
        toolCallId: toolCall.id,
        questions,
        context: runtimeContext.eventContext,
        onEvent: runtimeContext.onEvent,
        signal,
      });

      return {
        role: 'toolResult',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: 'text', text: answer }],
        isError: false,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        role: 'toolResult',
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
        isError: true,
        timestamp: Date.now(),
      };
    }
  }

  createPolicyLimitToolResult(toolCall: ToolCall, agentId: AgentRole, limit: string): ToolResultMessage {
    return {
      role: 'toolResult',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{ type: 'text', text: `POLICY_LIMIT_EXCEEDED: ${limit} for ${agentId}; tool execution was not started.` }],
      isError: true,
      details: { code: 'POLICY_LIMIT_EXCEEDED', limit },
      timestamp: Date.now(),
    };
  }

  createPolicyDeniedToolResult(toolCall: ToolCall, agentId: AgentRole, reason?: string): ToolResultMessage {
    return {
      role: 'toolResult',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{
        type: 'text',
        text: reason || `Policy denied tool "${toolCall.name}" for ${agentId}.`,
      }],
      isError: true,
      timestamp: Date.now(),
    };
  }

  createApprovalRequiredToolResult(
    toolCall: ToolCall,
    agentId: AgentRole,
    reason: string,
  ): ToolResultMessage {
    return {
      role: 'toolResult',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{
        type: 'text',
        text: `Approval required for tool "${toolCall.name}" before it can run for ${agentId}. ${reason} No changes were made.`,
      }],
      isError: true,
      timestamp: Date.now(),
    };
  }

  agentToolResultToMessage(toolCall: ToolCall, result: AgentToolResult): ToolResultMessage {
    return {
      role: 'toolResult',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: result.content,
      isError: result.isError === true,
      details: result.details,
      timestamp: Date.now(),
    };
  }
}
