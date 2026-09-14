import type {
  ConversationAnswerPlanReviewRequest,
  ConversationAnswerPlanReviewResult,
  ConversationAnswerToolApprovalRequest,
  ConversationAnswerToolApprovalResult,
  ConversationAnswerUserInputRequest,
  ConversationAnswerUserInputResult,
} from '@shared/types/conversation';
import { agentPlanReviewRequestService } from '../agent-runtime/interactions/AgentPlanReviewRequestService';
import { agentUserInputRequestService } from '../agent-runtime/interactions/AgentUserInputRequestService';
import { agentToolApprovalRequestService } from '../agent-runtime/permissions/AgentToolApprovalRequestService';

export function answerConversationUserInput(
  request: ConversationAnswerUserInputRequest,
): ConversationAnswerUserInputResult {
  return agentUserInputRequestService.answer(request);
}

export function answerConversationPlanReview(
  request: ConversationAnswerPlanReviewRequest,
): ConversationAnswerPlanReviewResult {
  return agentPlanReviewRequestService.answer(request);
}

export function answerConversationToolApproval(
  request: ConversationAnswerToolApprovalRequest,
): ConversationAnswerToolApprovalResult {
  return agentToolApprovalRequestService.answer(request);
}
