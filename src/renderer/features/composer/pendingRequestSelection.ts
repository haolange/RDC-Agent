import { findPendingToolApproval, type PendingToolApprovalRequest } from './toolApprovalRequestModel';
import { planReviewRequestKey, type PendingPlanReviewRequest } from './planReviewRequestModel';
import { createRequestFingerprint, findPendingUserInput, type PendingUserInputRequest } from './userInputRequestModel';
import type { ConversationMessage } from '@shared/types/conversation';

export type ComposerPendingRequestState =
  | { kind: 'tool-approval'; request: PendingToolApprovalRequest }
  | { kind: 'plan-review'; request: PendingPlanReviewRequest }
  | { kind: 'user-input'; request: PendingUserInputRequest };

/** One identity per request the Composer answers: its panel is keyed by it and Composer menus close when it changes. */
export function composerPendingRequestKey(pending: ComposerPendingRequestState): string {
  if (pending.kind === 'tool-approval') {
    return `tool-approval:${JSON.stringify([pending.request.sessionId, pending.request.turnId, pending.request.approvalId])}`;
  }
  return pending.kind === 'plan-review'
    ? `plan-review:${planReviewRequestKey(pending.request)}`
    : `user-input:${createRequestFingerprint(pending.request)}`;
}

export function resolveComposerPendingRequest(messages: ConversationMessage[], plan?: PendingPlanReviewRequest | null): ComposerPendingRequestState | null {
  const approval = findPendingToolApproval(messages);
  if (approval) return { kind: 'tool-approval', request: approval };
  if (plan) return { kind: 'plan-review', request: plan };
  const input = findPendingUserInput(messages);
  return input ? { kind: 'user-input', request: input } : null;
}
