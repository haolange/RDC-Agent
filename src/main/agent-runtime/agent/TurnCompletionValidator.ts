import type { CompletionArtifactRef } from '@shared/types/executionOffer';

export type CompletionDisposition = 'completed' | 'partial' | 'blocked' | 'cancelled' | 'budget_paused';

export interface TurnCompletionInput {
  profileId: string;
  turnId?: string;
  sessionId?: string | null;
  finalAnswerText: string;
  disposition?: CompletionDisposition;
  evidenceRefs?: readonly CompletionArtifactRef[];
}
export type TurnCompletionValidator = (input: TurnCompletionInput) => unknown;
