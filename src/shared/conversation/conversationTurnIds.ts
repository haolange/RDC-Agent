/** The ids one conversation request creates. */
export interface ConversationTurnIds {
  turnId: string;
  userMessageId: string;
  assistantMessageId: string;
  /** The notice main adds when the model switch drops the previous model's reasoning continuation. */
  noticeMessageId: string;
  /** The branch an edit-and-resend creates. */
  branchId: string;
}

/**
 * The ids of the turn, messages and branch a conversation request creates, derived from its request id. Main creates
 * them with this function and the renderer shows its messages under the same ids before main answers, so main's
 * answer updates those messages in place: nothing is re-keyed when it arrives. A request id names one turn (main
 * answers a repeated send with the same id from its idempotency record), so the ids never collide.
 */
export function conversationTurnIds(requestId: string): ConversationTurnIds {
  return {
    turnId: `turn-${requestId}`,
    userMessageId: `msgu-${requestId}`,
    assistantMessageId: `msga-${requestId}`,
    noticeMessageId: `msgs-${requestId}`,
    branchId: `branch-${requestId}`,
  };
}
