import type { CompletionArtifactRef } from '@shared/types/executionOffer';

export type CompletionDisposition = 'completed' | 'partial' | 'blocked' | 'cancelled' | 'budget_paused';

export interface TurnCompletionInput {
  profileId: string;
  /** Frozen profile contract. Omitted means this turn is not an investigation report. */
  completionContract?: 'final-answer' | 'investigation-report';
  /** Mission declared by a preloaded skill when the contract is investigation-report. */
  investigationMission?: 'debugger' | 'analyzer' | 'optimizer';
  turnId?: string;
  sessionId?: string | null;
  finalAnswerText: string;
  disposition?: CompletionDisposition;
  evidenceRefs?: readonly CompletionArtifactRef[];
  /** Host-observed limits in this turn; never populated from model arguments. */
  budgetEvidence?: { kind: 'provider-turns'; remaining: number; limit: number }
    | { kind: 'tool-calls'; consumed: number; limit: number };
}
export type TurnCompletionValidator = (input: TurnCompletionInput) => unknown;
export type TurnCompletionReadinessValidator = (input: Omit<TurnCompletionInput, 'finalAnswerText'>) => void | Promise<void>;

/** Main-only receipt of the owning Agent turn's successful contract validation. */
export interface TurnCompletionReceipt {
  turnId: string;
  runtimePlanFingerprint: string;
  initialRuntimePlanFingerprint?: string;
  runtimeEpochs?: import('@shared/types/taskExecution').TaskRuntimeEpoch[];
  finalAnswerText: string;
}
