import type { ConversationWorkTrace } from '@shared/types/conversation';
import { hasPlanReviewInteraction } from '@shared/conversation/planReviewPresentation';

/** Turn-end suggestions are a property of each handoff's surface, not of a profile id. */
export function shouldSnapshotHandoffSuggestions(input: {
  agentId: string;
  finalStatus: string;
  workTrace?: ConversationWorkTrace | null;
}): boolean {
  if (input.finalStatus !== 'complete') return false;
  if (hasPlanReviewInteraction(input.workTrace)) return false;
  return true;
}
