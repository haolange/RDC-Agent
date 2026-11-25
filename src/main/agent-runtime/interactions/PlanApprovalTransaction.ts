import { randomUUID } from 'node:crypto';
import { AppError } from '@shared/errors/appError';
import { nowMs } from '@shared/utils/id';
import { assertDeclaredHandoffForPlan, declaredExecutionOffer, declaredHandoffSuggestion } from '../../conversation/applyDeclaredHandoff';
import { assertSessionModelAndControls } from '../../conversation/sessionModelGate';
import { dispatchRuntimeHooks } from '../../hooks/runtimeHookDispatch';
import { executionOfferStore, projectWorkspaceStore, sessionRecordStore } from '../../sessions/store/sessionStores';
import { sessionRevisions } from '../../sessions/store/SessionRevisionRegistry';
import type { PlanArtifactWriter } from '../../sessions/run/sessionPlanArtifact';
import type { PlanReviewStateStore } from '../../sessions/run/PlanReviewStateStore';
import type { PlanTaskRequirement } from '@shared/types/taskExecution';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type {
  ConversationPlanReview,
  PlanReviewHandoffIdentity,
  PlanReviewHandoffSuggestion,
  PlanReviewStateDocument,
} from '@shared/types/planReview';
import type { SessionModelOverride, SessionRecordSnapshot, SessionRevision } from '@shared/types/session';

export interface PlanApprovalInput {
  sessionId: string;
  /** The turn that owns the review; the plan state must still name it. */
  turnId: string;
  sourceAgentId: string;
  planReview: ConversationPlanReview;
  handoff: PlanReviewHandoffIdentity;
  expectedPlanHash: string;
  model: SessionModelOverride;
  controls: ConversationTurnControls;
  baseRevision: SessionRevision;
}

export interface PlanApprovalDeps {
  writer: Pick<PlanArtifactWriter, 'stageFrozenPlan' | 'writeFrozenPlan' | 'discardFrozenPlan'>;
  store: Pick<PlanReviewStateStore, 'assertAwaiting' | 'replace'>;
  installTaskRevisions: (sessionId: string, tasks: readonly PlanTaskRequirement[]) => Promise<void>;
  /** False once the review was cancelled or answered while this approval awaited; nothing has been committed then. */
  isCurrent: () => boolean;
  /** A failed after-handoff hook; the committed approval stands, as for every other after-event. */
  onDiagnostic: (message: string) => void;
}

export interface PlanApprovalCommit {
  frozen: { uri: string; hash: string };
  planState: PlanReviewStateDocument;
  session: SessionRecordSnapshot;
  handoff: PlanReviewHandoffSuggestion;
}

function sameRevision(left: SessionRevision, right: SessionRevision): boolean {
  return left.epoch === right.epoch && left.n === right.n;
}

/**
 * Approving a plan, as one main transaction:
 * 1. verify the review, its owning turn, the reviewed plan hash and the session revision the choice was made on;
 * 2. check the model is executable and the controls plan into a request for it;
 * 3. run `agent.before-handoff`, which can veto;
 * 4. stage the frozen plan, the plan state, the execution offer and the session's Agent, model and controls;
 * 5. commit them in that order, logging each pre-image; any failure undoes the committed steps in reverse;
 * 6. run `agent.after-handoff`; its failure yields a diagnostic and no rollback.
 * The approved plan's Task revisions install idempotently before the commit, so a retried approval finds them done.
 */
export async function runPlanApprovalTransaction(input: PlanApprovalInput, deps: PlanApprovalDeps): Promise<PlanApprovalCommit> {
  const { sessionId } = input;
  const owner = { turnId: input.turnId, planId: input.planReview.planId, revision: input.planReview.revision };
  if (input.expectedPlanHash !== input.planReview.hash) {
    throw new AppError('PLAN_HASH_MISMATCH', 'the approval names a plan revision other than the one under review.');
  }
  if (!input.planReview.handoffOptions.some((option) => option.agent === input.handoff.agent && option.label === input.handoff.label)) {
    throw new AppError('DECLARED_HANDOFF_NOT_FOUND', 'the approved handoff is not one of the plan\'s declared continue actions.');
  }
  // The person chose on this record; this flow's own writes (Task events) may advance it later, so it is checked here.
  if (!sameRevision(sessionRevisions.revisionOf(sessionId), input.baseRevision)) {
    throw new AppError('SESSION_REVISION_STALE', 'the session record changed after the approval was chosen.');
  }
  deps.store.assertAwaiting(sessionId, owner);
  const session = sessionRecordStore.readSession(sessionId);
  if (!session) throw new AppError('PLAN_SESSION_NOT_FOUND', sessionId);
  const projectRoot = projectWorkspaceStore.getProjectById(session.projectId)?.rootPath ?? null;
  const staged = deps.writer.stageFrozenPlan(sessionId, input.expectedPlanHash);
  const declared = assertDeclaredHandoffForPlan({
    sourceAgentId: input.sourceAgentId, projectRoot, handoff: input.handoff, tasks: staged.taskRequirements,
  });

  await assertSessionModelAndControls(input.model, input.controls, projectRoot);

  const hookContext = {
    agentId: input.sourceAgentId,
    sessionId,
    projectRoot: projectRoot ?? undefined,
    payload: { toAgentId: declared.agent, prompt: declared.prompt, label: declared.label },
  };
  if (!await dispatchRuntimeHooks('agent.before-handoff', hookContext)) {
    throw new AppError('HOOK_DENIED', 'agent.before-handoff');
  }
  if (staged.taskRequirements.length) await deps.installTaskRevisions(sessionId, staged.taskRequirements);
  if (!deps.isCurrent()) throw new AppError('PLAN_REVIEW_SCOPE_CHANGED', 'the review was cancelled while the approval committed.');

  const approvedAt = nowMs();
  const previousState = deps.store.assertAwaiting(sessionId, owner);
  const planState: PlanReviewStateDocument = {
    ...previousState,
    status: 'approved',
    approvedHash: staged.hash,
    frozenUri: staged.uri,
    approvedHandoff: { ...input.handoff },
    updatedAt: approvedAt,
  };
  const previousOffer = executionOfferStore.read(sessionId);
  const sameApproval = previousOffer?.plan.uri === staged.uri && previousOffer.plan.hash === staged.hash
    && previousOffer.sourceAgentId === input.sourceAgentId && previousOffer.targetAgentId === declared.agent;
  const offer = declaredExecutionOffer({
    offerId: (sameApproval && previousOffer.offerId) || randomUUID(),
    sourceAgentId: input.sourceAgentId,
    declared,
    plan: { uri: staged.uri, hash: staged.hash },
    approvedAt,
  });

  const undo: Array<() => void> = [];
  let committed: SessionRecordSnapshot;
  try {
    deps.writer.writeFrozenPlan(sessionId, staged);
    undo.push(() => deps.writer.discardFrozenPlan(sessionId, staged.uri));
    deps.store.replace(sessionId, planState);
    undo.push(() => deps.store.replace(sessionId, previousState));
    executionOfferStore.write(sessionId, offer);
    undo.push(() => (previousOffer
      ? executionOfferStore.write(sessionId, previousOffer)
      : executionOfferStore.clear(sessionId)));
    // The last step: an atomic write that either lands whole or leaves session.json as it was.
    const updated = sessionRecordStore.updateSession(sessionId, {
      agentId: declared.agent, modelOverride: { ...input.model }, turnControls: { ...input.controls },
    });
    if (!updated) throw new AppError('PLAN_SESSION_NOT_FOUND', sessionId);
    committed = sessionRevisions.snapshot(updated);
  } catch (error) {
    for (const step of undo.reverse()) {
      try { step(); } catch (rollbackError) {
        deps.onDiagnostic(`Plan approval rollback step failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
    }
    throw error;
  }

  try {
    if (!await dispatchRuntimeHooks('agent.after-handoff', hookContext)) deps.onDiagnostic('HOOK_DENIED: agent.after-handoff');
  } catch (error) {
    deps.onDiagnostic(`agent.after-handoff failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    frozen: { uri: staged.uri, hash: staged.hash },
    planState,
    session: committed,
    handoff: declaredHandoffSuggestion(declared),
  };
}
