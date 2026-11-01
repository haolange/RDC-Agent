import type { ConversationMessage } from '@shared/types/conversation';
import { findPendingToolApproval, type PendingToolApprovalRequest } from './toolApprovalRequestModel';
import { type PendingPlanReviewRequest } from './planReviewRequestModel';
import { findPendingUserInput, type PendingUserInputRequest } from './userInputRequestModel';

export type ComposerPendingRequestState =
  | { kind: 'tool-approval'; request: PendingToolApprovalRequest }
  | { kind: 'plan-review'; request: PendingPlanReviewRequest }
  | { kind: 'user-input'; request: PendingUserInputRequest };

export function resolveComposerPendingRequest(messages: ConversationMessage[], plan?: PendingPlanReviewRequest | null): ComposerPendingRequestState | null {
  const approval = findPendingToolApproval(messages);
  if (approval) return { kind: 'tool-approval', request: approval };
  if (plan) return { kind: 'plan-review', request: plan };
  const input = findPendingUserInput(messages);
  return input ? { kind: 'user-input', request: input } : null;
}
