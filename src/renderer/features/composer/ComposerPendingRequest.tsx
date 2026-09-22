import { ToolApprovalRequestPanel } from './ToolApprovalRequestPanel';
import { PlanReviewRequestPanel } from './PlanReviewRequestPanel';
import { UserInputRequestPanel } from './UserInputRequestPanel';
import { planReviewRequestKey } from './planReviewRequestModel';
import { createRequestFingerprint } from './userInputRequestModel';
import type { ComposerPendingRequestState } from './pendingRequestSelection';

export function ComposerPendingRequest({ pending, composeAccentStyle }: {
  pending: ComposerPendingRequestState;
  composeAccentStyle: { 'data-dyn-style': string };
}) {
  if (pending.kind === 'tool-approval') {
    return <div className="composer-shell composer-shell-tool-approval" {...composeAccentStyle}>
      <ToolApprovalRequestPanel key={JSON.stringify([pending.request.sessionId, pending.request.turnId, pending.request.approvalId])} request={pending.request} />
    </div>;
  }
  if (pending.kind === 'plan-review') {
    return <div className="composer-shell composer-shell-plan-review" {...composeAccentStyle}>
      <PlanReviewRequestPanel key={planReviewRequestKey(pending.request)} request={pending.request} />
    </div>;
  }
  return <div className="composer-shell composer-shell-user-input" {...composeAccentStyle}>
    <UserInputRequestPanel key={createRequestFingerprint(pending.request)} request={pending.request} />
  </div>;
}
