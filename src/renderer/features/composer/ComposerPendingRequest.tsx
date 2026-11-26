import { ToolApprovalRequestPanel } from './ToolApprovalRequestPanel';
import { PlanReviewRequestPanel } from './PlanReviewRequestPanel';
import { UserInputRequestPanel } from './UserInputRequestPanel';
import { composerPendingRequestKey, type ComposerPendingRequestState } from './pendingRequestSelection';
import type { PlanReviewContinuation } from './usePlanReviewSubmit';
import type { SessionRecord } from '@shared/types/session';
import type { Ref } from 'react';

export function ComposerPendingRequest({
  pending,
  composeAccentStyle,
  agentId,
  currentSession,
  continuation,
  shellRef,
}: {
  pending: ComposerPendingRequestState;
  composeAccentStyle: { 'data-dyn-style': string };
  agentId: string;
  currentSession: SessionRecord | null;
  continuation: PlanReviewContinuation;
  shellRef?: Ref<HTMLDivElement>;
}) {
  if (pending.kind === 'tool-approval') {
    return (
      <div ref={shellRef} className="composer-shell composer-shell-tool-approval" {...composeAccentStyle}>
        <ToolApprovalRequestPanel key={composerPendingRequestKey(pending)} request={pending.request} />
      </div>
    );
  }
  if (pending.kind === 'plan-review') {
    return (
      <div ref={shellRef} className="composer-shell composer-shell-plan-review" {...composeAccentStyle}>
        <PlanReviewRequestPanel
          key={composerPendingRequestKey(pending)}
          request={pending.request}
          agentId={agentId}
          currentSession={currentSession}
          continuation={continuation}
        />
      </div>
    );
  }
  return (
    <div ref={shellRef} className="composer-shell composer-shell-user-input" {...composeAccentStyle}>
      <UserInputRequestPanel key={composerPendingRequestKey(pending)} request={pending.request} />
    </div>
  );
}
