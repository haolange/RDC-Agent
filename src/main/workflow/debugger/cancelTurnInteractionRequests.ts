import { agentPlanReviewRequestService } from '../../agent-runtime/interactions/AgentPlanReviewRequestService';
import { agentUserInputRequestService } from '../../agent-runtime/interactions/AgentUserInputRequestService';
import { agentToolApprovalRequestService } from '../../agent-runtime/permissions/AgentToolApprovalRequestService';

export function cancelTurnInteractionRequests(turnId: string): void {
  agentUserInputRequestService.cancelTurn(turnId);
  agentPlanReviewRequestService.cancelTurn(turnId);
  agentToolApprovalRequestService.cancelTurn(turnId);
}
