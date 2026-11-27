import { GENERAL_AGENT_ID } from '@shared/types/agent';
import { childScopePrefix, rootScopeId } from '@shared/utils/executionScope';
import { normalizeAskUserQuestions } from '@shared/utils/askUser';
import { AppError } from '@shared/errors/appError';
import { executeWithPermissionAdmission } from '../permissions/ToolPermissionAdmission';
import { withProcessExecutionOwner } from '../../runtime/ResourceExecutionLifetime';
import { getRdcTurnBinding } from '../../rdc/RdcTurnBindings';
/**
 * ToolExecutorFactory — createToolExecutor and tool-call mediation helpers.
 * Per-tool behaviour (concurrency class, host prompts, capture access, Knowledge roots,
 * result presentation) is read from the declared `AgentTool.spec`, never from the tool name.
 */

import { getWorkspaceRoot, withTemporaryPathAccess } from '../../runtime/toolFiles';
import { buildDiagnosticAgentEvent } from '../AgentEventBridge';
import { agentUserInputRequestService } from '../interactions/AgentUserInputRequestService';
import { authorizeToolPermission, ToolPermissionDenied } from '../permissions/ToolPermissionAuthorization';
import { hookEngine } from '../../hooks/HookEngine';
import { appPathService } from '../../runtime/AppPathService';
import { countSubagentDispatches, isConcurrencySafeSpec, resourceClaimOf } from '../agent/toolConcurrency';
import { sessionRecordStore } from '../../sessions/store/sessionStores';
import { artifactizeToolResult } from '../tools/ToolResultArtifactizer';
import { RdcNativeFailure } from '../../rdc/RdcNativeProtocol';
import { runtimePermissionStateService } from '../../runtime/RuntimePermissionStateService';
import { reserveDispatchBudget } from './TurnCoordinator';
import { normalizeToolName } from './RuntimeToolPolicy';
import { extractDeferredToolNamesFromToolSearchDetails } from './deferredTools';
import { flushPolicyBudgetObservers } from './DelegationBudget';
import { executePlanArtifact, type PlanArtifactToolCall } from './PlanArtifactSubmission';
import { toolResourceArbiter, toolResourceKey } from './ToolResourceArbiter';
import { settleRdcProcessFault } from './RdcProcessFaultRecovery';
import {
  admitToolCall,
  captureAccessDenial,
  errorToolResult,
  reserveCallBudget,
  validateToolArguments,
  type DenyTool,
  type ToolCallAdmissionDeps,
  type ToolExecutorScope,
  type ValidatedToolCall,
} from './ToolCallAdmission';
import type { RuntimeToolResolver, ToolExecutorRuntimeContext } from './orchestratorTypes';
import type { DeferredToolActivationTracker } from './DeferredToolActivationTracker';
import type { ToolCallContent, ToolResultMessage } from '../core/types';
import type { ToolCall } from '@shared/types/tool';
import type { ToolExecutor } from '../agent/AgentLoop';
import type { AgentTool, AgentToolResult, ToolExecutionContext } from '../agent/AgentTool';
import type { HookEvent } from '@shared/types/rdcRuntime';
import type { AgentRole } from '@shared/types/agent';
import type { AgentPermissionDecision } from '../permissions/AgentPermissionPolicy';
import type { RuntimePermissionState } from '@shared/types/runtimePermission';

export interface ToolExecutorFactoryDeps extends ToolCallAdmissionDeps {
  deferredActivation: DeferredToolActivationTracker;
  tools: Pick<RuntimeToolResolver, 'resolveRuntimeTools'>;
}

export class ToolExecutorFactory {
  private readonly successfulFileReads = new Map<string, Set<string>>();

  releaseSession(sessionId: string): void {
    this.successfulFileReads.delete(sessionId);
    for (const key of this.successfulFileReads.keys()) {
      if (key.startsWith(childScopePrefix(sessionId))) this.successfulFileReads.delete(key);
    }
  }

  private sessionFileReads(sessionId: string | null | undefined): Set<string> {
    if (!sessionId) return new Set();
    let reads = this.successfulFileReads.get(sessionId);
    if (!reads) {
      reads = new Set();
      this.successfulFileReads.set(sessionId, reads);
    }
    return reads;
  }
  constructor(private readonly deps: ToolExecutorFactoryDeps) {}

  activateDeferredTools(toolNames: string[], sessionId?: string | null): void {
    const activation = this.deps.activeTurns.getActiveTurn(sessionId)?.deferredActivation ?? null;
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
    const scope = this.createExecutorScope(agentId, toolAllowlist, sessionId, runtimeContext);
    const specOf = (toolName: string) => scope.tools.get(normalizeToolName(toolName))?.spec;
    return {
      shouldEndTurnAfterToolResult: (result) => {
        const turn = this.deps.activeTurns.getActiveTurn(sessionId);
        if (turn?.rdcRecoveryBlocker?.toolCallId === result.toolCallId) return true;
        // The result names the tool exactly as called; only the canonical name resolves.
        return (
          !result.isError &&
          scope.tools.get(result.toolName)?.spec.interaction === 'plan-review' &&
          turn?.approvedPlan?.toolCallId === result.toolCallId
        );
      },
      isConcurrencySafe: (toolCall: ToolCall) => isConcurrencySafeSpec(specOf(toolCall.name)),
      reserveDispatchBudget: (toolCalls: ToolCall[]) => {
        const cost = {
          toolCalls: toolCalls.length,
          subagents: countSubagentDispatches(toolCalls.map((call) => specOf(call.name))),
        };
        const reserved = reserveDispatchBudget(runtimeContext?.policyBudget, cost);
        if (reserved.ok) {
          for (const call of toolCalls) {
            scope.reservedCallIds.add(call.id);
          }
        }
        return reserved;
      },
      execute: (toolCall, signal, onUpdate, onExecutionStart) =>
        this.executeToolCall(scope, toolCall, signal, onUpdate, onExecutionStart),
    };
  }

  /** Frozen constraints / skills / policy / toolAllowlist come from the plan; mode is main-owned live state. */
  private createExecutorScope(
    agentId: AgentRole,
    toolAllowlist: string[],
    sessionId: string | null | undefined,
    runtimeContext: ToolExecutorRuntimeContext | undefined,
  ): ToolExecutorScope {
    const plan = runtimeContext?.effectivePlan;
    const effectiveToolAllowlist = plan ? [...plan.toolAllowlist] : toolAllowlist;
    const tools = this.deps.tools.resolveRuntimeTools(
      agentId,
      // Match the prepared schemas, including the tool_search closure. Building
      // from the broader profile list advertises tools the frozen Skill forbids.
      [...(plan?.skillIntersection ?? effectiveToolAllowlist)],
      sessionId,
      this.deps.activeTurns.getActiveTurn(sessionId),
      runtimeContext?.projectId ?? plan?.projectId,
      runtimeContext?.projectRootPath ?? plan?.projectRootPath,
      runtimeContext?.mcpPoolKey ?? null,
      { excludeRdcLeaseTools: plan?.excludeRdcLeaseTools === true, excludeSubagent: plan?.excludeSubagent === true },
    ).toolMap;
    // Skill allowed-tools 收窄集（DESIGN Skills 条款：只收窄、不扩展）。
    // 多 skill：allowedTools = ∩(skill_i) ∩ runtimeAllowlist（空声明不参与）。
    return {
      agentId,
      sessionId,
      runtimeContext,
      plan,
      effectiveToolAllowlist,
      tools,
      activeSkillAllowlist: plan?.skillIntersection ? new Set(plan.skillIntersection) : null,
      planActivatedDeferredTools: new Set(plan?.activatedDeferredTools ?? []),
      reservedCallIds: new Set<string>(),
    };
  }

  private async executeToolCall(
    scope: ToolExecutorScope,
    toolCall: ToolCallContent,
    signal?: AbortSignal,
    onUpdate?: (partialResult: unknown) => void,
    onExecutionStart?: (permissionState?: RuntimePermissionState) => void,
  ): Promise<ToolResultMessage> {
    const { agentId, runtimeContext, sessionId } = scope;
    const denyTool: DenyTool = (reason, details) =>
      this.createPolicyDeniedToolResult(toolCall, agentId, reason, runtimeContext, details);
    const admitted = admitToolCall(this.deps, scope, toolCall, denyTool);
    if (!admitted.ok) return admitted.result;
    const tool = admitted.value;
    const exhaustedLimit = reserveCallBudget(scope, toolCall);
    if (exhaustedLimit) return this.createPolicyLimitToolResult(toolCall, agentId, exhaustedLimit);
    await flushPolicyBudgetObservers(runtimeContext?.policyBudget);
    const validated = validateToolArguments(tool, toolCall);
    if (!validated.ok) return validated.result;
    const call: ValidatedToolCall = { toolCall, tool, args: validated.value };
    const captureDenial = captureAccessDenial(
      call,
      this.deps.activeTurns.getActiveTurn(runtimeContext?.sessionId ?? sessionId),
    );
    if (captureDenial) return denyTool(captureDenial);
    if (tool.spec.interaction === 'user-input') {
      return this.executeAskUserTool(
        { ...toolCall, arguments: call.args },
        agentId,
        runtimeContext,
        signal,
        onExecutionStart,
      );
    }
    if (tool.spec.interaction === 'plan-review') {
      return this.executePlanArtifactTool({
        toolCall: { ...toolCall, arguments: call.args },
        agentId,
        runtimeContext,
        signal,
        onExecutionStart,
      });
    }
    return this.executeToolEffect(scope, call, denyTool, signal, onUpdate, onExecutionStart);
  }

  private buildExecutionContext(
    scope: ToolExecutorScope,
    tool: AgentTool,
    executorSessionId: string | null,
  ): ToolExecutionContext {
    const { plan, runtimeContext, sessionId } = scope;
    const projectRootPath = runtimeContext?.projectRootPath ?? plan?.projectRootPath ?? null;
    const executionPlan = this.deps.activeTurns.getActiveTurn(executorSessionId)?.runtimePlan ?? plan;
    return {
      successfulFileReads: this.sessionFileReads(runtimeContext?.sessionId ?? sessionId),
      rdcBinding: executionPlan ? getRdcTurnBinding(executionPlan) : undefined,
      captureControl: this.deps.activeTurns.getActiveTurn(executorSessionId)?.captureControl ?? undefined,
      agentId: scope.agentId,
      accessCeiling: plan?.accessCeiling,
      turnId: runtimeContext?.turnId,
      excludeRdcLeaseTools: plan?.excludeRdcLeaseTools,
      workspaceRoot: projectRootPath ?? getWorkspaceRoot(),
      projectRootPath,
      projectId: runtimeContext?.projectId ?? plan?.projectId ?? null,
      sessionId: runtimeContext?.sessionId ?? null,
      visionInputMode: plan?.routeCapability.visionInputMode ?? 'disabled',
      ...(tool.spec.knowledgeRoots === 'reference' ? { knowledgeReadRoots: plan?.knowledgeReadRoots ?? [] } : {}),
    };
  }

  /** Final permission admission, resource claim, the tool effect, lifecycle hooks and result presentation. */
  private async executeToolEffect(
    scope: ToolExecutorScope,
    call: ValidatedToolCall,
    denyTool: DenyTool,
    signal?: AbortSignal,
    onUpdate?: (partialResult: unknown) => void,
    onExecutionStart?: (permissionState?: RuntimePermissionState) => void,
  ): Promise<ToolResultMessage> {
    const { agentId, plan, runtimeContext, sessionId, tools, activeSkillAllowlist } = scope;
    const { toolCall, tool, args: validatedArgs } = call;
    const validatedToolCall: ToolCallContent = { ...toolCall, arguments: validatedArgs };
    const executorSessionId = runtimeContext?.sessionId ?? sessionId ?? null;
    let sessionAttachmentsRoot: string | null = null;
    if (executorSessionId) {
      try {
        sessionAttachmentsRoot = sessionRecordStore.getSessionAttachmentsDir(executorSessionId);
      } catch {
        sessionAttachmentsRoot = null;
      }
    }
    const knowledgeReadRoots = plan?.knowledgeReadRoots ?? [];
    const projectRootPath = runtimeContext?.projectRootPath ?? plan?.projectRootPath ?? null;
    const toolContext = this.buildExecutionContext(scope, tool, executorSessionId);
    const policyBudget = runtimeContext?.policyBudget;
    const permissionConstraints = plan?.permissionConstraints;
    if (signal?.aborted) return denyTool('Tool call cancelled before execution.');
    if (policyBudget) {
      const current = reserveDispatchBudget(policyBudget, { toolCalls: 0, subagents: 0 });
      if (!current.ok) return this.createPolicyLimitToolResult(toolCall, agentId, current.limit);
    }
    try {
      let executionAnnounced = false;
      const announceExecution = (state: RuntimePermissionState) => {
        if (!executionAnnounced) {
          executionAnnounced = true;
          onExecutionStart?.(state);
        }
      };
      if (!permissionConstraints)
        return denyTool('PERMISSION_CONSTRAINTS_MISSING: a prepared runtime plan is required.');
      const beforeExecute = async () => {
        const beforeHooks = await this.triggerRuntimeHooks('tool.before-call', agentId, runtimeContext, {
          toolName: toolCall.name,
          toolCallId: toolCall.id,
          arguments: structuredClone(validatedArgs),
        });
        if (!beforeHooks.allowed) {
          throw new ToolPermissionDenied(
            `A blocking lifecycle hook denied this tool call: ${beforeHooks.reason ?? 'reason unavailable'}`,
          );
        }
      };
      const injectKnowledgeRoots = tool.spec.knowledgeRoots === 'read-access';
      const executeEffect = (permissionDecision: AgentPermissionDecision, permissionState: RuntimePermissionState) =>
        withProcessExecutionOwner(runtimeContext?.sessionId ?? sessionId, () =>
          withTemporaryPathAccess(
            toolContext,
            [...permissionDecision.temporaryPathRoots, ...(injectKnowledgeRoots ? knowledgeReadRoots : [])],
            (scopedContext) => {
              announceExecution(permissionState);
              return tool.execute(toolCall.id, validatedArgs, signal, onUpdate, scopedContext);
            },
          ),
        );
      // Unsafe effects from parent and detached children share the same
      // session/project gate. Orchestration calls take no claim; locking a
      // dispatcher here would deadlock while awaiting child effects.
      const ownerSessionId = rootScopeId(runtimeContext?.sessionId ?? sessionId ?? 'ephemeral');
      // Project files/shell state are shared across sessions; use the
      // canonical project root when available and fall back to session
      // ownership only for ephemeral/no-project execution.
      const resourceKey = toolResourceKey(projectRootPath, ownerSessionId);
      const admissionTurn = this.deps.activeTurns.getActiveTurn(executorSessionId);
      const admissionGeneration = admissionTurn?.generation;
      const argumentIdentity = JSON.stringify(validatedArgs);
      const assertLive = () => {
        if (
          JSON.stringify(validatedArgs) !== argumentIdentity ||
          (admissionTurn && !admissionTurn.isLive(admissionGeneration!))
        ) {
          throw new AppError('PERMISSION_ADMISSION_STALE', 'call arguments or turn changed.');
        }
      };
      const result = await executeWithPermissionAdmission({
        signal,
        beforeExecute,
        assertLive,
        authorize: (snapshot, approvalSignal) =>
          authorizeToolPermission(
            {
              decision: {
                executionContext: toolContext,
                effectiveToolNames: [...tools.keys()].filter(
                  (name) => !activeSkillAllowlist || activeSkillAllowlist.has(name),
                ),
                tool,
                toolCall: validatedToolCall,
                projectRootPath,
                permissionConstraints,
                compiledPolicy: plan.policy,
                sessionAttachmentsRoot,
                knowledgeReadRoots,
              },
              approval:
                runtimeContext?.eventContext && runtimeContext.turnId
                  ? {
                      agentId,
                      sessionId: runtimeContext.sessionId ?? null,
                      turnId: runtimeContext.turnId,
                      toolCallId: toolCall.id,
                      toolName: toolCall.name,
                      context: runtimeContext.eventContext,
                      onEvent: runtimeContext.onEvent,
                    }
                  : undefined,
              reviewer: runtimeContext?.reviewPermission,
              executionBudget: policyBudget,
              assertLive,
            },
            snapshot,
            approvalSignal,
          ),
        withResource: async (operation, permissionState) => {
          // The affected child may itself be waiting for this resource. Join it
          // after authorization but before taking the recovery's exclusive lock.
          if (
            tool.spec.capture?.recovers?.(validatedArgs) &&
            toolContext.captureControl &&
            toolContext.agentId === GENERAL_AGENT_ID &&
            toolContext.accessCeiling === 'full' &&
            toolContext.turnId &&
            toolContext.sessionId &&
            toolContext.projectId
          ) {
            announceExecution(permissionState);
            await toolContext.captureControl.prepareRecovery(permissionState.revision, signal);
          }
          const claim = resourceClaimOf(tool.spec);
          return claim === 'none'
            ? operation()
            : claim === 'shared'
              ? toolResourceArbiter.runShared(resourceKey, signal, operation)
              : toolResourceArbiter.runExclusive(resourceKey, signal, operation);
        },
        execute: executeEffect,
      });
      await this.triggerRuntimeHooks('tool.after-call', agentId, runtimeContext, {
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        isError: result.isError === true,
      });
      // Deferred 激活：仅声明 activatesDeferredTools 的发现工具可激活；直接调用未激活 deferred → 上文已 fail-closed。
      if (tool.spec.activatesDeferredTools === true && result.isError !== true) {
        this.activateDeferredTools(
          extractDeferredToolNamesFromToolSearchDetails(result.details),
          runtimeContext?.sessionId,
        );
      }
      // skill_read is discovery only. Armed-skill ∩ is frozen on prepareTurn
      // from profile.skills / composer $skill / /skills — not from a read.
      return this.agentToolResultToMessage(toolCall, this.presentToolResult(scope, call, result));
    } catch (error) {
      if (error instanceof ToolPermissionDenied)
        return error.requiresApproval
          ? this.createApprovalRequiredToolResult(toolCall, agentId, error.message)
          : denyTool(error.message, error.details);
      await this.triggerRuntimeHooks('tool.on-error', agentId, runtimeContext, {
        toolName: toolCall.name,
        toolCallId: toolCall.id,
        error: error instanceof Error ? error.message : String(error),
      });
      if (tool.spec.presentation?.deliversNativeFailure && error instanceof RdcNativeFailure && error.deliveryResult)
        return this.deliverNativeFailure(scope, toolCall, toolContext, error, error.deliveryResult, signal);
      return errorToolResult(toolCall, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * A native failure reaches the model as pinned evidence. A stuck or lost worker on an approved capture first gets
   * the post-call recovery step, whose outcome rides on the same result; a blocker ends an autonomous turn.
   */
  private async deliverNativeFailure(
    scope: ToolExecutorScope,
    toolCall: ToolCallContent,
    toolContext: ToolExecutionContext,
    error: RdcNativeFailure,
    delivered: AgentToolResult,
    signal?: AbortSignal,
  ): Promise<ToolResultMessage> {
    const sessionId = scope.runtimeContext?.sessionId ?? scope.sessionId;
    const projectRootPath = scope.runtimeContext?.projectRootPath ?? scope.plan?.projectRootPath ?? null;
    const resourceKey = toolResourceKey(projectRootPath, rootScopeId(sessionId ?? 'ephemeral'));
    const runtimeRecovery = await settleRdcProcessFault({
      error,
      control: toolContext.captureControl,
      permission: runtimePermissionStateService.getSnapshot(),
      runExclusive: (operation) => toolResourceArbiter.runExclusive(resourceKey, signal, operation),
      signal,
    });
    let result = delivered;
    if (runtimeRecovery) {
      const details = { ...(result.details as Record<string, unknown>), runtimeRecovery };
      result = { ...result, content: [{ type: 'text', text: JSON.stringify(details) }], details };
      const turn = this.deps.activeTurns.getActiveTurn(toolContext.sessionId);
      if (turn && runtimeRecovery.status === 'blocked' && runtimeRecovery.stopsTurn)
        turn.rdcRecoveryBlocker = {
          toolCallId: toolCall.id,
          code: runtimeRecovery.code,
          reason: runtimeRecovery.reason,
        };
    }
    return this.agentToolResultToMessage(
      toolCall,
      artifactizeToolResult({
        sessionId,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result,
        pinBelowThreshold: true,
      }),
    );
  }

  /** Error results stay inline unless the tool keeps them; the rest go through the session artifact path. */
  private presentToolResult(
    scope: ToolExecutorScope,
    call: ValidatedToolCall,
    result: AgentToolResult,
  ): AgentToolResult {
    const presentation = call.tool.spec.presentation;
    if (result.isError === true && !presentation?.keepErrorResults) return result;
    return artifactizeToolResult({
      sessionId: scope.runtimeContext?.sessionId ?? scope.sessionId,
      toolCallId: call.toolCall.id,
      toolName: call.toolCall.name,
      result,
      pinBelowThreshold: presentation?.pinEvidence?.(call.args, result) === true,
    });
  }

  async triggerRuntimeHooks(
    event: HookEvent,
    agentId: AgentRole,
    runtimeContext: ToolExecutorRuntimeContext | undefined,
    payload: Record<string, unknown>,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const projectRoot = runtimeContext?.projectRootPath ?? undefined;
    hookEngine.load(appPathService.getUserRdcPaths().hooksPath, projectRoot ?? undefined);
    const results = await toolResourceArbiter
      .runExclusive(toolResourceKey(projectRoot, runtimeContext?.sessionId ?? 'ephemeral'), undefined, () =>
        withProcessExecutionOwner(runtimeContext?.sessionId, () =>
          hookEngine.trigger(event, {
            event,
            agentId,
            toolName: typeof payload.toolName === 'string' ? payload.toolName : undefined,
            sessionId: runtimeContext?.sessionId ?? undefined,
            projectRoot: projectRoot ?? undefined,
            payload,
          }),
        ),
      )
      .catch(() => null);
    // A quarantined process prevents further hook effects; the original tool
    // result must still reach the caller without waiting for an unknown exit.
    if (!results) return { allowed: false, reason: 'Hook process state could not be confirmed' };
    for (const result of results) {
      if (!runtimeContext?.eventContext || !runtimeContext.onEvent) continue;
      runtimeContext.onEvent(
        buildDiagnosticAgentEvent(runtimeContext.eventContext, {
          code: `hook.${result.status}`,
          severity: result.status === 'completed' ? 'info' : result.allowed ? 'warning' : 'error',
          message: `Hook ${result.hookId}: ${result.status}${!result.allowed && result.reason ? ` · ${result.reason}` : ''}`,
          toolCallId: typeof payload.toolCallId === 'string' ? payload.toolCallId : undefined,
          technicalMessage: JSON.stringify({
            exitCode: result.exitCode,
            reason: result.reason,
            stdout: result.stdout,
            stderr: result.stderr,
          }),
        }),
      );
    }
    const blockingResult = results.find((result) => !result.allowed);
    return blockingResult
      ? { allowed: false, reason: blockingResult.reason ?? `Hook ${blockingResult.hookId} failed` }
      : { allowed: true };
  }

  /** Runs a plan_artifact call against this factory's active turns. */
  executePlanArtifactTool(call: PlanArtifactToolCall): Promise<ToolResultMessage> {
    return executePlanArtifact({ ...call, activeTurns: this.deps.activeTurns });
  }

  async executeAskUserTool(
    toolCall: ToolCallContent,
    agentId: AgentRole,
    runtimeContext: ToolExecutorRuntimeContext | undefined,
    signal?: AbortSignal,
    onExecutionStart?: () => void,
  ): Promise<ToolResultMessage> {
    try {
      const args = toolCall.arguments;
      const questions = normalizeAskUserQuestions(args);
      if (questions.length === 0) {
        throw new Error('ask_user requires at least one canonical questions[] entry with a prompt.');
      }

      if (!runtimeContext?.eventContext || !runtimeContext.turnId) {
        throw new Error('ask_user requires an active conversation interaction bridge.');
      }

      onExecutionStart?.();
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
      content: [
        { type: 'text', text: `POLICY_LIMIT_EXCEEDED: ${limit} for ${agentId}; tool execution was not started.` },
      ],
      isError: true,
      details: { code: 'POLICY_LIMIT_EXCEEDED', limit },
      timestamp: Date.now(),
    };
  }

  async createPolicyDeniedToolResult(
    toolCall: ToolCallContent,
    agentId: AgentRole,
    reason?: string,
    runtimeContext?: ToolExecutorRuntimeContext,
    details?: object,
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
      content: [
        {
          type: 'text',
          text: message,
        },
      ],
      isError: true,
      ...(details ? { details } : {}),
      timestamp: Date.now(),
    };
  }

  createApprovalRequiredToolResult(toolCall: ToolCallContent, agentId: AgentRole, reason: string): ToolResultMessage {
    return {
      role: 'toolResult',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [
        {
          type: 'text',
          text: `Approval required for tool "${toolCall.name}" before it can run for ${agentId}. ${reason} No changes were made.`,
        },
      ],
      isError: true,
      timestamp: Date.now(),
    };
  }

  agentToolResultToMessage(toolCall: ToolCallContent, result: AgentToolResult): ToolResultMessage {
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
