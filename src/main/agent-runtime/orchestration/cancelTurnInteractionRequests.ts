import { agentPlanReviewRequestService } from '../interactions/AgentPlanReviewRequestService';
import { agentUserInputRequestService } from '../interactions/AgentUserInputRequestService';
import { agentToolApprovalRequestService } from '../permissions/AgentToolApprovalRequestService';

export function cancelTurnInteractionRequests(turnId: string): void {
  agentUserInputRequestService.cancelTurn(turnId);
  agentPlanReviewRequestService.cancelTurn(turnId);
  agentToolApprovalRequestService.cancelTurn(turnId);
}
