import type { ConversationThinkingStatus } from '@shared/types/conversation';
import type { ThinkingArtifact } from '@shared/types/reasoning';

export interface ConversationLoopRuntimeState {
  loopSeq: number;
  currentLoopText: string;
  currentLoopThinking: ThinkingArtifact | undefined;
  currentLoopThinkingStatus: ConversationThinkingStatus | undefined;
  loopHasTools: boolean;
  pendingNewLoop: boolean;
  visibleResponse: string;
}

export function beginAssistantContentLoopIfPending(
  state: ConversationLoopRuntimeState,
): ConversationLoopRuntimeState {
  if (!state.pendingNewLoop) return state;
  return {
    loopSeq: state.loopSeq + 1,
    currentLoopText: '',
    currentLoopThinking: undefined,
    currentLoopThinkingStatus: undefined,
    loopHasTools: false,
    pendingNewLoop: false,
    visibleResponse: '',
  };
}
