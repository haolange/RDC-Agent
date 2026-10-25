import type { ConversationWorkTrace } from '@shared/types/conversation';
import { isMissionProfileId } from '@shared/constants/missionPlanOnly';
import { hasPlanReviewInteraction } from '@shared/conversation/planReviewPresentation';

export function shouldSnapshotHandoffSuggestions(input: {
  agentId: string;
  finalStatus: string;
  workTrace?: ConversationWorkTrace | null;
}): boolean {
  if (input.finalStatus !== 'complete') return false;
  if (hasPlanReviewInteraction(input.workTrace)) return false;
  if (!isMissionProfileId(input.agentId)) return true;
  return false;
}
