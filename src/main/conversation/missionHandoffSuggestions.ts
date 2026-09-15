import type { ConversationToolCall, ConversationWorkBlock, ConversationWorkTrace } from '@shared/types/conversation';
import { isMissionProfileId } from '@shared/constants/missionPlanOnly';
import { normalizeToolName } from '../workflow/debugger/DebuggerRuntimePolicy';

export function hasApprovedPlanArtifact(trace: ConversationWorkTrace | null | undefined): boolean {
  return collectToolCalls(trace?.blocks ?? []).some((call: ConversationToolCall) => (
    normalizeToolName(call.toolName) === 'plan_artifact'
    && call.planReview?.status === 'approved'
  ));
}

export function shouldSnapshotHandoffSuggestions(input: {
  agentId: string;
  finalStatus: string;
  workTrace?: ConversationWorkTrace | null;
}): boolean {
  if (input.finalStatus !== 'complete') return false;
  if (!isMissionProfileId(input.agentId)) return true;
  return hasApprovedPlanArtifact(input.workTrace);
}

function collectToolCalls(blocks: ConversationWorkBlock[]): ConversationToolCall[] {
  return blocks.flatMap((block) => [
    ...block.toolCalls,
    ...collectToolCalls(block.children ?? []),
  ]);
}
