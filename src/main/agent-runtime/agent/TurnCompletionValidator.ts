import type { CompletionArtifactRef } from '@shared/types/executionOffer';

export type CompletionDisposition = 'completed' | 'partial' | 'blocked' | 'cancelled' | 'budget_paused';

export interface TurnCompletionInput {
  profileId: string;
  /** Frozen profile contract. Omitted only for direct contract tests of builtin mission ids. */
  completionContract?: 'final-answer' | 'investigation-report';
  /** Mission declared by a preloaded skill when the contract is investigation-report. */
  investigationMission?: 'debugger' | 'analyzer' | 'optimizer';
  turnId?: string;
  sessionId?: string | null;
  finalAnswerText: string;
  disposition?: CompletionDisposition;
  evidenceRefs?: readonly CompletionArtifactRef[];
}
export type TurnCompletionValidator = (input: TurnCompletionInput) => unknown;
