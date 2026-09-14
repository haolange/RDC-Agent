import React from 'react';
import { ToolApprovalRequestPanel, usePendingToolApprovalRequest } from './ToolApprovalRequestPanel';
import { PlanReviewRequestPanel, usePendingPlanReviewRequest } from './PlanReviewRequestPanel';
import { UserInputRequestPanel, usePendingUserInputRequest } from './UserInputRequestPanel';

export function useComposerPendingGate(
  composeAccentStyle: { 'data-dyn-style': string },
): React.ReactElement | null {
  const pendingToolApproval = usePendingToolApprovalRequest();
  const pendingPlanReview = usePendingPlanReviewRequest();
  const pendingUserInput = usePendingUserInputRequest();

  if (pendingToolApproval) {
    return (
      <div className="composer-shell composer-shell-tool-approval" {...composeAccentStyle}>
        <ToolApprovalRequestPanel request={pendingToolApproval} />
      </div>
    );
  }

  if (pendingPlanReview) {
    return (
      <div className="composer-shell composer-shell-plan-review" {...composeAccentStyle}>
        <PlanReviewRequestPanel request={pendingPlanReview} />
      </div>
    );
  }

  if (pendingUserInput) {
    return (
      <div className="composer-shell composer-shell-user-input" {...composeAccentStyle}>
        <UserInputRequestPanel request={pendingUserInput} />
      </div>
    );
  }

  return null;
}
