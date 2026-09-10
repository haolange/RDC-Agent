import { flushPolicyBudgetObservers } from './DelegationBudget';
import { withProcessExecutionOwner } from '../../runtime/ResourceExecutionLifetime';
import { getRdxTurnBinding } from '../../tools/RdxTurnBindings';
/**
 * ToolExecutorFactory — createToolExecutor and tool-call mediation helpers.
 */

import type { AgentRole } from '@shared/types/agent';
import type { HookEvent } from '@shared/types/rdxRuntime';
import { normalizeAskUserQuestions } from '@shared/utils/askUser';
import type { AgentToolResult, ToolExecutionContext } from '../../agent-runtime/agent/AgentTool';
import { toolToDefinition } from '../../agent-runtime/agent/AgentTool';
import type { ToolExecutor } from '../../agent-runtime/agent/AgentLoop';
import type { ToolCall, ToolResultMessage } from '../../agent-runtime/core/types';
import { getWorkspaceRoot, withTemporaryPathAccess } from '../../agent-runtime/tools/primitives/_shared';
import { isKnowledgeReadFileTool } from '../../agent-runtime/knowledgeReadRoots';
import { buildDiagnosticAgentEvent } from '../../agent-runtime/AgentEventBridge';
import { agentUserInputRequestService } from '../../agent-runtime/interactions/AgentUserInputRequestService';
import { agentPermissionPolicyService } from '../../agent-runtime/permissions/AgentPermissionPolicy';
import { agentToolApprovalRequestService } from '../../agent-runtime/permissions/AgentToolApprovalRequestService';
import { isToolDeniedByPolicy } from '../../agent-runtime/permissions/PolicyCompiler';
import { ToolValidationError, toolValidator } from '../../agent-runtime/core/ToolValidator';
import { hookEngine } from '../../hooks/HookEngine';
import { appPathService } from '../../runtime/AppPathService';
import {
  extractDeferredToolNamesFromToolSearchDetails,
  isDeferredToolName,
} from './deferredTools';
import { normalizeToolName } from './DebuggerRuntimePolicy';
import { isRdxLeaseToolName } from '@shared/constants/rdxLeaseTools';
import type { AgentSlotRegistry } from './AgentSlotRegistry';
import type { DeferredToolActivationTracker } from './DeferredToolActivationTracker';
import { reserveDispatchBudget, type TurnHandle } from './TurnCoordinator';
import { countSubagentCalls, isAgentToolCallConcurrencySafe } from '../../agent-runtime/agent/toolConcurrency';
import type { ResolvedRuntimeTools, ToolExecutorRuntimeContext } from './orchestratorTypes';
import { storageAdapter } from '../../sessions/StorageAdapter';
import { artifactizeToolResult } from '../../agent-runtime/tools/ToolResultArtifactizer';
import { toolResourceArbiter, toolResourceKey } from './ToolResourceArbiter';

export interface ToolExecutorFactoryDeps {
  slots: AgentSlotRegistry;
  deferredActivation: DeferredToolActivationTracker;
  getActiveTurn: (sessionId?: string | null) => TurnHandle | null;
  resolveRuntimeTools: (
    agentId: AgentRole,
    toolAllowlist: string[],
    sessionId?: string | null,
    turnHandle?: TurnHandle | null,
    projectId?: string | null,
    projectRootPath?: string | null,
    mcpPoolKey?: string | null,
    options?: { excludeRdxLeaseTools?: boolean },
  ) => ResolvedRuntimeTools;
  isAllowedForRuntime: (
    agentId: AgentRole,
    toolName: string,
    frozenToolAllowlist?: readonly string[],
    excludeRdxLeaseTools?: boolean,
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
      sessionId,
      this.deps.getActiveTurn(sessionId),
      runtimeContext?.projectId ?? plan?.projectId,
      runtimeContext?.projectRootPath ?? plan?.projectRootPath,
      runtimeContext?.mcpPoolKey ?? null,
      { excludeRdxLeaseTools: plan?.excludeRdxLeaseTools === true },
    ).toolMap;
    // Skill allowed-tools 收窄集（DESIGN Skills 条款：只收窄、不扩展）。
    // 多 skill：allowedTools = ∩(skill_i) ∩ runtimeAllowlist（空声明不参与）。
    // Frozen on prepareTurn. skill_read does not re-narrow mid-turn.
    let activeSkillAllowlist: Set<string> | null = plan?.skillIntersection
      ? new Set(plan.skillIntersection)
      : null;
    // 无 plan 时才从 settings 解析 preloaded skills；有 plan 则用冻结的 skillIntersection。
    const permissionSettings = plan?.permissionSettings;
    const compiledPolicy = plan?.policy;
    const planActivatedDeferredTools = new Set(plan?.activatedDeferredTools ?? []);
    const reservedCallIds = new Set<string>();
    return {
      isConcurrencySafe: (toolCall: ToolCall) => {
        const normalizedName = normalizeToolName(toolCall.name);
        return isAgentToolCallConcurrencySafe(tools.get(normalizedName), {
          ...toolCall,
          name: normalizedName,
        });
      },
      reserveDispatchBudget: (toolCalls: ToolCall[]) => {
        const cost = {
          toolCalls: toolCalls.length,
          subagents: countSubagentCalls(toolCalls.map((call) => ({ name: normalizeToolName(call.name) }))),
        };
        const reserved = reserveDispatchBudget(runtimeContext?.policyBudget, cost);
        if (reserved.ok) {
          for (const call of toolCalls) {
            reservedCallIds.add(call.id);
          }
        }
        return reserved;
      },
      execute: async (toolCall: ToolCall, signal?: AbortSignal, onUpdate?: (partialResult: unknown) => void) => {
        const denyTool = (reason?: string) => this.createPolicyDeniedToolResult(
          toolCall,
          agentId,
          reason,
          runtimeContext,
        );
        const normalizedName = normalizeToolName(toolCall.name);
        if (
          (plan?.excludeRdxLeaseTools && isRdxLeaseToolName(toolCall.name))
          || !this.deps.isAllowedForRuntime(
            agentId,
            toolCall.name,
            effectiveToolAllowlist,
            plan?.excludeRdxLeaseTools === true,
          )
          || !tools.has(normalizedName)
        ) {
          return denyTool();
        }
        if (
          activeSkillAllowlist !== null
          && !this.deps.matchesToolAllowlist(normalizedName, Array.from(activeSkillAllowlist))
        ) {
          return denyTool(
            `Tool "${toolCall.name}" is outside the allowed-tools set declared by the active skill.`,
          );
        }
        if (compiledPolicy && isToolDeniedByPolicy(compiledPolicy, normalizedName)) {
          return denyTool(
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
          return denyTool();
        }
        const policyBudget = runtimeContext?.policyBudget;
        const alreadyReserved = reservedCallIds.delete(toolCall.id);
        if (policyBudget && !alreadyReserved) {
          const reserved = reserveDispatchBudget(policyBudget, { toolCalls: 1, subagents: 0 });
          if (!reserved.ok) {
            return this.createPolicyLimitToolResult(toolCall, agentId, reserved.limit);
          }
        }
        await flushPolicyBudgetObservers(policyBudget);
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
        const sessionId = runtimeContext?.sessionId ?? null;
        let sessionAttachmentsRoot: string | null = null;
        if (sessionId) {
          try {
            sessionAttachmentsRoot = storageAdapter.getSessionAttachmentsDir(sessionId);
          } catch {
            sessionAttachmentsRoot = null;
          }
        }
        const knowledgeReadRoots = plan?.knowledgeReadRoots ?? [];
        const permissionDecision = agentPermissionPolicyService.evaluate({
          tool,
          toolCall: validatedToolCall,
          agentId,
          projectRootPath: runtimeContext?.projectRootPath ?? plan?.projectRootPath ?? null,
          ...(permissionSettings ? { permissionSettings } : {}),
          ...(compiledPolicy ? { compiledPolicy } : {}),
          ...(sessionAttachmentsRoot ? { sessionAttachmentsRoot } : {}),
          ...(knowledgeReadRoots.length > 0 ? { knowledgeReadRoots } : {}),
        });
        if (permissionDecision.action === 'deny') {
          return denyTool(permissionDecision.reason);
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
            return denyTool('User denied this tool call.');
          }
        }
        if (permissionDecision.action === 'auto_review') {
          if (!runtimeContext?.eventContext || !runtimeContext.turnId) {
            return denyTool('Auto-review requires an active conversation turn.');
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
            return denyTool('Auto-review denied this tool call.');
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
            return denyTool('A blocking lifecycle hook denied this tool call.');
          }
          const toolContext: ToolExecutionContext = {
            rdxBinding: plan ? getRdxTurnBinding(plan) : undefined,
            agentId,
            turnId: runtimeContext?.turnId,
            excludeRdxLeaseTools: plan?.excludeRdxLeaseTools,
            workspaceRoot: projectRootPath ?? getWorkspaceRoot(),
            projectRootPath,
            projectId: runtimeContext?.projectId ?? plan?.projectId ?? null,
            sessionId: runtimeContext?.sessionId ?? null,
            visionInputMode: plan?.routeCapability?.visionInputMode ?? 'disabled',
          };
          const injectKnowledgeRoots = isKnowledgeReadFileTool(normalizedName);
          const executeToolEffect = () => withProcessExecutionOwner(runtimeContext?.sessionId ?? sessionId, () => withTemporaryPathAccess(
            toolContext,
            [
              ...(permissionDecision.temporaryPathRoots ?? []),
              ...(injectKnowledgeRoots ? knowledgeReadRoots : []),
            ],
            (scopedContext) => tool.execute(
              toolCall.id,
              validatedArgs,
              signal,
              onUpdate,
              scopedContext,
            ),
          ));
          // Unsafe effects from parent and detached children share the same
          // session/project gate. The subagent call itself is orchestration;
          // locking it here would deadlock while awaiting child effects.
          const ownerSessionId = (runtimeContext?.sessionId ?? sessionId ?? 'ephemeral').split('::subagent::', 1)[0];
          // Project files/shell state are shared across sessions; use the
          // canonical project root when available and fall back to session
          // ownership only for ephemeral/no-project execution.
          const resourceKey = toolResourceKey(projectRootPath, ownerSessionId);
          const result = tool.spec?.orchestration === true
            ? await executeToolEffect()
            : isAgentToolCallConcurrencySafe(tool, validatedToolCall)
              ? await toolResourceArbiter.runShared(resourceKey, signal, executeToolEffect)
              : await toolResourceArbiter.runExclusive(resourceKey, signal, executeToolEffect);
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
          // skill_read is discovery only. Armed-skill ∩ is frozen on prepareTurn
          // from profile.skills / composer $skill / /skills — not from a read.
          const finalized = result.isError === true
            ? result
            : artifactizeToolResult({
                sessionId: runtimeContext?.sessionId ?? sessionId,
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                result,
              });
          return this.agentToolResultToMessage(toolCall, finalized);
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
    const results = await toolResourceArbiter.runExclusive(
      toolResourceKey(projectRoot, runtimeContext?.sessionId ?? 'ephemeral'),
      undefined,
      () => withProcessExecutionOwner(runtimeContext?.sessionId, () => hookEngine.trigger(event, {
      event,
      agentId,
      toolName: typeof payload.toolName === 'string' ? payload.toolName : undefined,
      sessionId: runtimeContext?.sessionId ?? undefined,
      projectRoot: projectRoot ?? undefined,
      payload,
    }))).catch(() => null);
    // A quarantined process prevents further hook effects; the original tool
    // result must still reach the caller without waiting for an unknown exit.
    if (!results) return false;
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

  async createPolicyDeniedToolResult(
    toolCall: ToolCall,
    agentId: AgentRole,
    reason?: string,
    runtimeContext?: ToolExecutorRuntimeContext,
  ): Promise<ToolResultMessage> {
    const message = reason || `Policy denied tool "${toolCall.name}" for ${agentId}.`;
    await this.triggerRuntimeHooks('permission.denied', agentId, runtimeContext, {
      toolName: toolCall.name,
      toolCallId: toolCall.id,
      reason: message,
    });
    return {
      role: 'toolResult',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{
        type: 'text',
        text: message,
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
