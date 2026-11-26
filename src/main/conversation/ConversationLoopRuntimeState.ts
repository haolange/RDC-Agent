export interface ConversationLoopRuntimeState {
  loopSeq: number;
  currentLoopText: string;
  loopHasTools: boolean;
  pendingNewLoop: boolean;
  visibleResponse: string;
}

export function beginAssistantContentLoopIfPending(state: ConversationLoopRuntimeState): ConversationLoopRuntimeState {
  if (!state.pendingNewLoop) return state;
  return {
    loopSeq: state.loopSeq + 1,
    currentLoopText: '',
    loopHasTools: false,
    pendingNewLoop: false,
    visibleResponse: '',
  };
}
