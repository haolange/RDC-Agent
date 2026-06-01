import React, { useMemo } from 'react';
import type { AgentWorkstreamPresentation } from '@shared/types/workstream';
import { getElectronApi } from '../../../platform/getElectronApi';
import { TaskWorkstream, UserEvent, UserPromptBubble } from './WorkstreamBlocks';
import './AgentWorkstream.css';

const WorkstreamBranchNavigator: React.FC<{
  navigator: NonNullable<AgentWorkstreamPresentation['branchNavigator']>;
  sessionId: string;
}> = ({ navigator, sessionId }) => (
  <nav className="aw-branch-navigator" data-testid="aw-branch-navigator">
    <button
      type="button"
      disabled={navigator.branchIndex <= 0}
      onClick={() => {
        const prev = navigator.branches[Math.max(navigator.branchIndex - 1, 0)];
        if (prev) void getElectronApi()?.workflow.switchWorkstreamBranch(sessionId, prev.id);
      }}
    >
      ‹
    </button>
    <span>{navigator.branchIndex + 1}/{navigator.branchCount}</span>
    <button
      type="button"
      disabled={navigator.branchIndex >= navigator.branchCount - 1}
      onClick={() => {
        const next = navigator.branches[Math.min(navigator.branchIndex + 1, navigator.branches.length - 1)];
        if (next) void getElectronApi()?.workflow.switchWorkstreamBranch(sessionId, next.id);
      }}
    >
      ›
    </button>
  </nav>
);

interface AgentWorkstreamProps {
  presentation: AgentWorkstreamPresentation | null;
  emptyState: React.ReactNode;
}

export const AgentWorkstream: React.FC<AgentWorkstreamProps> = ({ presentation, emptyState }) => {
  const visibleItems = useMemo(() => presentation?.items ?? [], [presentation?.items]);
  if (!presentation || visibleItems.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <div className="agent-workstream" data-testid="agent-workstream">
      {presentation.branchNavigator && presentation.branchNavigator.branchCount > 1 ? (
        <WorkstreamBranchNavigator navigator={presentation.branchNavigator} sessionId={presentation.sessionId} />
      ) : null}
      {visibleItems.map((item) => {
        if (item.kind === 'task_workstream') {
          return <TaskWorkstream key={item.id} task={item} sessionId={presentation.sessionId} />;
        }
        if (item.kind === 'user_confirmation') {
          return <UserEvent key={item.id} kind="confirmed" label={item.label} createdAt={item.createdAt} />;
        }
        if (item.kind === 'user_revision') {
          return <UserEvent key={item.id} kind="revision" label={item.prompt} createdAt={item.createdAt} />;
        }
        return <UserPromptBubble key={item.id} prompt={item} sessionId={presentation.sessionId} />;
      })}
    </div>
  );
};

export default AgentWorkstream;
