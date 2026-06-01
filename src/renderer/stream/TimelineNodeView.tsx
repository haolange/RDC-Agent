import React from 'react';
import type { AgentNode, GroupPayload, TimelineProjection } from '@shared/types/agentTimeline';
import type { ExpandedState } from '../services/timelineFormatters';
import {
  getChildren,
  getPayload,
  shouldDefaultExpand,
  shouldShowNode,
} from '../services/timelineFormatters';
import { AgentThinkingBubble } from './AgentThinkingBubble';
import { PlanCard } from './PlanCard';
import { SubAgentRow } from './SubAgentRow';
import {
  EvidenceView,
  FinalAnswerView,
  GenericWorkBlock,
  MergeView,
  MetricsSummaryView,
  RawDetailView,
  WorkflowStatusGroupView,
} from './TaskResultBlock';
import { ArtifactGrid, ExpandButton, StatusBadge } from './TimelinePrimitives';
import { ToolRow } from './ToolRow';
import { UserPromptBubble } from './UserPromptBubble';

const GroupView: React.FC<{
  projection: TimelineProjection;
  node: AgentNode;
  expanded: boolean;
  expandedState: ExpandedState;
  showOnlyFailed: boolean;
  collapseSuccessfulTools: boolean;
  onToggle: (id: string, expanded: boolean) => void;
  onJumpEvidence: (id: string) => void;
}> = ({
  projection,
  node,
  expanded,
  expandedState,
  showOnlyFailed,
  collapseSuccessfulTools,
  onToggle,
  onJumpEvidence,
}) => {
  const payload = getPayload<GroupPayload>(node);
  const children = getChildren(projection, node).filter((child) => shouldShowNode(projection, child, showOnlyFailed));
  const subAgents = children.filter((child) => child.type === 'subagent_run');
  const otherChildren = children.filter((child) => child.type !== 'subagent_run');

  if (payload?.groupType === 'artifact_group') {
    return (
      <section className="amt-artifact-section" data-testid="agent-timeline-artifacts" data-node-id={node.id}>
        <header className="amt-section-header">
          <span className="amt-node-icon" aria-hidden="true">⌘</span>
          <strong>{node.title}</strong>
          <ExpandButton expanded={expanded} onClick={() => onToggle(node.id, expanded)} label={`切换 ${node.title}`} />
        </header>
        {expanded ? <ArtifactGrid artifacts={children} /> : null}
      </section>
    );
  }

  const groupTestId = payload?.groupType === 'subagent_group'
    ? 'agent-timeline-subagent-group'
    : 'agent-timeline-group';

  return (
    <section className={`amt-group amt-node-status-${node.status}`} data-testid={groupTestId} data-node-id={node.id}>
      <header className="amt-section-header">
        <span className="amt-node-icon" aria-hidden="true">☷</span>
        <strong>{node.title}</strong>
        {payload?.strategy ? <span className="amt-group-strategy">{payload.strategy}</span> : null}
        <StatusBadge status={node.status} />
        {payload?.progress ? <span className="amt-muted">{payload.progress.completed}/{payload.progress.total} 完成</span> : null}
        <ExpandButton expanded={expanded} onClick={() => onToggle(node.id, expanded)} label={`切换 ${node.title}`} />
      </header>
      {expanded ? (
        <>
          <div className="amt-subagent-list">
            {subAgents.map((child) => <SubAgentRow key={child.id} node={child} />)}
          </div>
          <div className="amt-work-block-children">
            {otherChildren.map((child) => (
              <TimelineNodeView
                key={child.id}
                projection={projection}
                node={child}
                expandedState={expandedState}
                showOnlyFailed={showOnlyFailed}
                collapseSuccessfulTools={collapseSuccessfulTools}
                onToggle={onToggle}
                onJumpEvidence={onJumpEvidence}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
};

export const TimelineNodeView: React.FC<{
  projection: TimelineProjection;
  node: AgentNode;
  expandedState: ExpandedState;
  showOnlyFailed: boolean;
  collapseSuccessfulTools: boolean;
  onToggle: (id: string, expanded: boolean) => void;
  onJumpEvidence: (id: string) => void;
}> = ({
  projection,
  node,
  expandedState,
  showOnlyFailed,
  collapseSuccessfulTools,
  onToggle,
  onJumpEvidence,
}) => {
  const expanded = expandedState[node.id] ?? shouldDefaultExpand(node, collapseSuccessfulTools);

  if (node.type === 'plan_card') {
    return <PlanCard node={node} />;
  }
  if (node.type === 'workflow_status_group') {
    return (
      <WorkflowStatusGroupView
        node={node}
        expanded={expanded}
        onToggle={() => onToggle(node.id, expanded)}
      />
    );
  }
  if (node.type === 'tool_call') {
    return <ToolRow node={node} expanded={expanded} onToggle={() => onToggle(node.id, expanded)} />;
  }
  if (node.type === 'group') {
    return (
      <GroupView
        projection={projection}
        node={node}
        expanded={expanded}
        expandedState={expandedState}
        showOnlyFailed={showOnlyFailed}
        collapseSuccessfulTools={collapseSuccessfulTools}
        onToggle={onToggle}
        onJumpEvidence={onJumpEvidence}
      />
    );
  }
  if (node.type === 'subagent_run') {
    return <SubAgentRow node={node} />;
  }
  if (node.type === 'merge') {
    return <MergeView node={node} />;
  }
  if (node.type === 'final_answer') {
    return <FinalAnswerView node={node} onJumpEvidence={onJumpEvidence} />;
  }
  if (node.type === 'metrics_summary') {
    return <MetricsSummaryView node={node} />;
  }
  if (node.type === 'evidence') {
    return <EvidenceView node={node} />;
  }
  if (node.type === 'raw_detail') {
    return <RawDetailView node={node} />;
  }

  return (
    <GenericWorkBlock
      projection={projection}
      node={node}
      expanded={expanded}
      expandedState={expandedState}
      showOnlyFailed={showOnlyFailed}
      collapseSuccessfulTools={collapseSuccessfulTools}
      onToggle={onToggle}
      onJumpEvidence={onJumpEvidence}
      renderChild={(child) => (
        <TimelineNodeView
          projection={projection}
          node={child}
          expandedState={expandedState}
          showOnlyFailed={showOnlyFailed}
          collapseSuccessfulTools={collapseSuccessfulTools}
          onToggle={onToggle}
          onJumpEvidence={onJumpEvidence}
        />
      )}
    />
  );
};

export const ProjectionView: React.FC<{
  projection: TimelineProjection;
  expandedState: ExpandedState;
  showOnlyFailed: boolean;
  collapseSuccessfulTools: boolean;
  onToggle: (id: string, expanded: boolean) => void;
  onJumpEvidence: (id: string) => void;
}> = ({
  projection,
  expandedState,
  showOnlyFailed,
  collapseSuccessfulTools,
  onToggle,
  onJumpEvidence,
}) => {
  const roots = projection.rootNodeIds
    .map((id) => projection.nodes[id])
    .filter(Boolean)
    .filter((node) => shouldShowNode(projection, node, showOnlyFailed));

  return (
    <div className="amt-turn" data-testid="conversation-turn" data-agent-testid="agent-timeline-turn">
      {roots.map((root) => {
        if (root.type === 'user_message') {
          return <UserPromptBubble key={root.id} node={root} />;
        }
        if (root.type === 'assistant_message') {
          return <AgentThinkingBubble key={root.id} node={root} />;
        }
        return (
          <TimelineNodeView
            key={root.id}
            projection={projection}
            node={root}
            expandedState={expandedState}
            showOnlyFailed={showOnlyFailed}
            collapseSuccessfulTools={collapseSuccessfulTools}
            onToggle={onToggle}
            onJumpEvidence={onJumpEvidence}
          />
        );
      })}
    </div>
  );
};
