/**
 * PlanArtifactSubmission — executes one plan_artifact call in named phases: read the submission, check the planning
 * turn, freeze the plan's Task requirements and investigation capture scope, then write the live plan and wait for
 * the user's review. Every failure becomes an error tool result for the model.
 */

import { AppError } from '@shared/errors/appError';
import { isHandoffContinueAction } from '../interactions/handoffSurface';
import { agentPlanReviewRequestService } from '../interactions/AgentPlanReviewRequestService';
import { assertDeclaredHandoffForPlan } from '../interactions/applyDeclaredHandoff';
import { composePlanMarkdown, planArtifactWriter, sectionsFromMarkdown } from '../../sessions/run/sessionPlanArtifact';
import { planReviewStateStore } from '../../sessions/run/PlanReviewStateStore';
import { projectWorkspaceStore, sessionRecordStore } from '../../sessions/store/sessionStores';
import { prepareInvestigationPlan } from '../../rdc/prepareInvestigationPlan';
import { rdcSessionService } from '../../rdc/RdcSessionService';
import { TaskRegistry, createSessionTaskStore, getDelegatedTaskScope } from '../tasks';
import { preparePlanTaskRequirements } from '../tasks/TaskExecutionRequirements';
import { listUnfinishedDirectTasks } from './DirectTaskTurnLifecycle';
import type { AgentRole } from '@shared/types/agent';
import type { ToolCallContent, ToolResultMessage } from '../core/types';
import type { TurnHandle } from './TurnCoordinator';
import type { ActiveTurnLookup, ToolExecutorRuntimeContext } from './orchestratorTypes';

/** One plan_artifact call: the call, the submitting Agent and the turn's runtime context. */
export interface PlanArtifactToolCall {
  toolCall: ToolCallContent;
  agentId: AgentRole;
  runtimeContext: ToolExecutorRuntimeContext | undefined;
  signal?: AbortSignal;
  onExecutionStart?: () => void;
}

export interface PlanArtifactCall extends PlanArtifactToolCall {
  activeTurns: ActiveTurnLookup;
}

/** A validated submission inside an active conversation interaction bridge and session. */
interface PlanSubmission {
  args: Record<string, unknown>;
  title: string;
  content: string;
  summary: string[];
  sessionId: string;
  turnId: string;
  eventContext: NonNullable<ToolExecutorRuntimeContext['eventContext']>;
  runtimeContext: ToolExecutorRuntimeContext;
  handoffOptions: Array<{ label: string; agent: string; labelTranslations?: Record<string, string> }>;
}

type PlanTaskRequirements = Awaited<ReturnType<typeof preparePlanTaskRequirements>>;
type PlanInvestigation = Awaited<ReturnType<typeof prepareInvestigationPlan>> | null;

export async function executePlanArtifact(call: PlanArtifactCall): Promise<ToolResultMessage> {
  try {
    const submission = readPlanSubmission(call);
    const turnHandle = await checkPlanningTurn(call, submission);
    const taskRequirements = await freezePlanTaskRequirements(submission, turnHandle);
    const investigation = await freezePlanInvestigation(submission);
    return await submitPlanForReview(call, submission, turnHandle, taskRequirements, investigation);
  } catch (error) {
    return {
      role: 'toolResult',
      toolCallId: call.toolCall.id,
      toolName: call.toolCall.name,
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
      isError: true,
      details: error instanceof Error && error.name === 'AbortError' ? { reason: 'abort' } : undefined,
      timestamp: Date.now(),
    };
  }
}

/** Title, a 1-4 line summary and content, an interaction bridge, a session and a declared continue handoff. */
function readPlanSubmission(call: PlanArtifactCall): PlanSubmission {
  const { toolCall, runtimeContext } = call;
  const args = toolCall.arguments;
  const title = typeof args.title === 'string' ? args.title.trim() : '';
  const content = typeof args.content === 'string' ? args.content.trim() : '';
  const summary = Array.isArray(args.summary)
    ? args.summary.map((line) => (typeof line === 'string' ? line.trim() : '')).filter(Boolean)
    : [];
  if (!title || !content || summary.length < 1 || summary.length > 4) {
    throw new Error('plan_artifact requires title, 1-4 summary lines, and content.');
  }
  if (!runtimeContext?.eventContext || !runtimeContext.turnId) {
    throw new Error('plan_artifact requires an active conversation interaction bridge.');
  }
  const sessionId = runtimeContext.sessionId ?? null;
  if (!sessionId) {
    throw new Error('plan_artifact requires an active session.');
  }
  const handoffOptions = (runtimeContext.effectivePlan?.profileHandoffs ?? [])
    .filter((handoff) => isHandoffContinueAction(handoff) && handoff.label.trim() && handoff.agent.trim())
    .map((handoff) => ({
      label: handoff.label.trim(),
      agent: handoff.agent.trim(),
      ...(handoff.labelTranslations ? { labelTranslations: { ...handoff.labelTranslations } } : {}),
    }));
  if (handoffOptions.length === 0) {
    throw new AppError('PLAN_REVIEW_NO_HANDOFF', 'plan_artifact requires a declared continue handoff on this profile.');
  }
  return {
    args,
    title,
    content,
    summary,
    sessionId,
    turnId: runtimeContext.turnId,
    eventContext: runtimeContext.eventContext,
    runtimeContext,
    handoffOptions,
  };
}

/** The planning turn must still be the active one, with every direct Task it ran settled. */
async function checkPlanningTurn(call: PlanArtifactCall, submission: PlanSubmission): Promise<TurnHandle | null> {
  const turnHandle = call.activeTurns.getActiveTurn(submission.sessionId);
  if (turnHandle) {
    if (turnHandle.turnId !== submission.turnId)
      throw new AppError('PLAN_TURN_CHANGED', 'the planning turn is no longer active.');
    const unfinished = await listUnfinishedDirectTasks({
      sessionId: submission.sessionId,
      turnId: turnHandle.turnId,
      generation: turnHandle.generation,
    });
    if (unfinished.length) {
      throw new AppError(
        'PLAN_DIRECT_TASKS_UNSETTLED',
        `Plan approval ends this planning turn, but direct Tasks are still active: ${unfinished.map((item) => item.taskId).join(', ')}. Settle each with its actual result before submitting the plan. Do not claim that approval has already happened; keep work that begins after approval pending, and do not make it depend on a blocked planning task merely waiting for approval.`,
      );
    }
  }
  return turnHandle;
}

/** The Tasks the plan requires (and their proposed revisions), frozen into the reviewed plan. */
async function freezePlanTaskRequirements(
  submission: PlanSubmission,
  turnHandle: TurnHandle | null,
): Promise<PlanTaskRequirements> {
  const { args, sessionId } = submission;
  const requiredTaskIds = args.requiredTaskIds;
  const delegatedScope = getDelegatedTaskScope(sessionId);
  if (delegatedScope && (requiredTaskIds !== undefined || args.taskRevisions !== undefined)) {
    throw new AppError(
      'TASK_SCOPE_DENIED',
      'approved Task bindings and revisions belong to the owning planner session, not a delegated Capsule.',
    );
  }
  if (
    requiredTaskIds !== undefined &&
    (!Array.isArray(requiredTaskIds) ||
      requiredTaskIds.length > 128 ||
      requiredTaskIds.some((id) => typeof id !== 'string' || !id.trim()) ||
      new Set(requiredTaskIds).size !== requiredTaskIds.length)
  ) {
    throw new AppError('PLAN_TASK_REQUIREMENTS_INVALID', 'requiredTaskIds must be distinct existing Task ids.');
  }
  if (turnHandle && !delegatedScope && requiredTaskIds === undefined) {
    const registry = new TaskRegistry(createSessionTaskStore(sessionId));
    const turnRef = `turn:${turnHandle.turnId}:generation:${turnHandle.generation}`;
    const unsettled = (await registry.listTasks()).filter(
      (task) => task.creationTurnRef === turnRef && (task.status === 'pending' || task.status === 'blocked'),
    );
    if (unsettled.length) {
      throw new AppError(
        'PLAN_TASK_BINDINGS_UNDECLARED',
        `This planning turn created unfinished Tasks: ${unsettled.map((task) => task.id).join(', ')}. Explicitly set requiredTaskIds to the existing Tasks required by this plan, or [] if none are required. Task names or IDs in Markdown do not freeze their requirements.`,
      );
    }
  }
  const registry =
    Array.isArray(requiredTaskIds) && requiredTaskIds.length
      ? new TaskRegistry(createSessionTaskStore(sessionId))
      : null;
  if (args.taskRevisions !== undefined && !registry)
    throw new AppError('PLAN_TASK_REQUIREMENTS_INVALID', 'taskRevisions requires requiredTaskIds.');
  return registry ? await preparePlanTaskRequirements(registry, requiredTaskIds as string[], args.taskRevisions) : [];
}

/** An investigation plan freezes its mission contract and the capture scope it may use. */
async function freezePlanInvestigation(submission: PlanSubmission): Promise<PlanInvestigation> {
  const { args, sessionId, runtimeContext } = submission;
  const sourcePlan = runtimeContext.effectivePlan;
  if (args.captureScope !== undefined && (!sourcePlan || sourcePlan.completionContract !== 'investigation-report')) {
    throw new AppError('PLAN_CAPTURE_SCOPE_INVALID', 'capture scope requires an investigation plan.');
  }
  return sourcePlan?.completionContract === 'investigation-report' && sourcePlan.investigationMission
    ? await prepareInvestigationPlan({
        mission: sourcePlan.investigationMission,
        sessionId,
        projectId: runtimeContext.projectId ?? sourcePlan.projectId,
        captureScope: args.captureScope,
        host: {
          sessionProjectId: (id) => sessionRecordStore.readSessionRecord(id)?.projectId ?? null,
          project: (id) => projectWorkspaceStore.getProjectById(id),
          replayState: (owner, projectId) =>
            rdcSessionService.snapshotReplayForSession({ sessionId: owner, projectId }),
        },
      })
    : null;
}

/** The declared handoffs must accept the plan; then the live plan is written and the user reviews it. */
async function submitPlanForReview(
  call: PlanArtifactCall,
  submission: PlanSubmission,
  turnHandle: TurnHandle | null,
  taskRequirements: PlanTaskRequirements,
  investigation: PlanInvestigation,
): Promise<ToolResultMessage> {
  const { toolCall, agentId } = call;
  const { runtimeContext, sessionId, title, summary, content, handoffOptions } = submission;
  for (const handoff of handoffOptions)
    assertDeclaredHandoffForPlan({
      sourceAgentId: agentId,
      projectRoot: runtimeContext.projectRootPath ?? runtimeContext.effectivePlan?.projectRootPath ?? null,
      handoff,
      tasks: taskRequirements,
    });
  const markdown = composePlanMarkdown({ title, summary, content, taskRequirements, investigation });
  if (turnHandle) turnHandle.approvedPlan = null;
  call.onExecutionStart?.();
  const written = planArtifactWriter.writeLivePlan(sessionId, markdown);
  const revision = planReviewStateStore.beginRevision(sessionId, submission.turnId);
  const planReview = {
    planId: revision.planId,
    revision: revision.revision,
    uri: written.uri,
    hash: written.hash,
    title,
    summary,
    sections: sectionsFromMarkdown(markdown),
    status: 'awaiting' as const,
    handoffOptions,
  };
  const answer = await agentPlanReviewRequestService.request({
    agentId,
    sessionId,
    turnId: submission.turnId,
    toolCallId: toolCall.id,
    planReview,
    turnHandle,
    context: submission.eventContext,
    onEvent: runtimeContext.onEvent,
    signal: call.signal,
  });
  return {
    role: 'toolResult',
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: 'text', text: answer }],
    isError: false,
    timestamp: Date.now(),
  };
}
