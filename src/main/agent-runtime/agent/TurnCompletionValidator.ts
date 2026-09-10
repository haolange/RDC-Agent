import type { HandoffContract, HandoffArtifactRef } from '@shared/types/handoffContract';

export type CompletionDisposition = 'completed' | 'partial' | 'blocked' | 'cancelled' | 'budget_paused';

/** Application composition supplies task-specific completion checks. */
export interface TaskCompletionBinding {
  handoffId: string;
  returnTo: string;
  deliveryRequirements: string;
  dispatchedAt: number;
  validationPolicy: string;
}
export interface TurnCompletionInput {
  profileId: string;
  turnId?: string;
  sessionId?: string | null;
  finalAnswerText: string;
  disposition?: CompletionDisposition;
  evidenceRefs?: readonly HandoffArtifactRef[];
  pendingHandoff?: boolean;
  pendingHandoffTarget?: string;
  taskBinding?: Readonly<TaskCompletionBinding> | null;
}
export type TurnCompletionValidator = (input: TurnCompletionInput) => unknown;

/** Identity-independent execution return invariant. Domain extensions validate artifact contents. */
export function enforceTaskReturnBinding(
  input: TurnCompletionInput,
  pending: { contract: HandoffContract } | null,
): void {
  const binding = input.taskBinding;
  if (!binding) return;
  if (!input.pendingHandoff || input.pendingHandoffTarget !== binding.returnTo) {
    throw new Error('TASK_COMPLETION_DENIED: Bound execution must return to ' + binding.returnTo + ' for evaluation.');
  }
  if (!pending || pending.contract.intent !== 'return' || pending.contract.executionHandoffId !== binding.handoffId) {
    throw new Error('TASK_COMPLETION_DENIED: Execution return must match the frozen task binding.');
  }
}
