import React from 'react';
import type {
  AgentNode,
  EvidencePayload,
  FinalAnswerPayload,
  MergePayload,
  MetricsSummaryPayload,
  PhasePayload,
  RawDetailPayload,
  StepPayload,
  TimelineProjection,
  WorkflowStatusGroupPayload,
} from '@shared/types/agentTimeline';
import type { ExpandedState } from '../services/timelineFormatters';
import {
  formatDuration,
  formatStatusEntryTime,
  formatTime,
  getChildren,
  getPayload,
  shouldShowNode,
} from '../services/timelineFormatters';
import { EvidenceBadge, ExpandButton, StatusBadge } from './TimelinePrimitives';

export const RawDetailView: React.FC<{ node: AgentNode }> = ({ node }) => {
  const payload = getPayload<RawDetailPayload>(node);
  if (!payload) {
    return null;
  }

  const content = typeof payload.content === 'string'
    ? payload.content
    : JSON.stringify(payload.content, null, 2);

  return (
    <pre className="amt-raw-detail" data-testid="agent-timeline-raw-detail">
      {payload.title ? <span className="amt-raw-detail-title">{payload.title}</span> : null}
      <code>{content}</code>
    </pre>
  );
};

export const MergeView: React.FC<{ node: AgentNode }> = ({ node }) => {
  const payload = getPayload<MergePayload>(node);

  return (
    <section className="amt-merge" data-testid="agent-timeline-merge" data-node-id={node.id}>
      <header className="amt-section-header">
        <span className="amt-node-icon" aria-hidden="true">⌘</span>
        <strong>{node.title}</strong>
        <StatusBadge status={node.status} />
      </header>
      <div className="amt-merge-grid">
        <div>
          <span className="amt-metric-label">一致性</span>
          <strong>{payload?.confidence !== undefined ? payload.confidence.toFixed(2) : '—'}</strong>
        </div>
        <div>
          <span className="amt-metric-label">冲突</span>
          <strong>{payload?.conflicts.length ?? 0} 处</strong>
        </div>
        <div>
          <span className="amt-metric-label">采用结论</span>
          <strong>{payload?.selectedFindings.length ?? 0}</strong>
        </div>
      </div>
      {payload?.finalSynthesis ? <p>{payload.finalSynthesis}</p> : null}
      {payload?.agreements.length ? (
        <ul className="amt-compact-list">
          {payload.agreements.map((agreement) => <li key={agreement}>{agreement}</li>)}
        </ul>
      ) : null}
    </section>
  );
};

export const FinalAnswerView: React.FC<{
  node: AgentNode;
  onJumpEvidence: (id: string) => void;
}> = ({ node, onJumpEvidence }) => {
  const payload = getPayload<FinalAnswerPayload>(node);

  return (
    <section className="amt-final-answer" data-testid="agent-timeline-final-answer" data-node-id={node.id}>
      <header className="amt-section-header">
        <span className="amt-node-icon" aria-hidden="true">⚑</span>
        <strong>{node.title}</strong>
        <span className="amt-muted">{formatTime(node.createdAt)}</span>
      </header>
      <p>{payload?.answer ?? node.summary}</p>
      {payload?.claims.length ? (
        <ul className="amt-claim-list">
          {payload.claims.map((claim) => (
            <li key={claim.id}>
              <span>{claim.text}</span>
              <EvidenceBadge evidenceRefs={claim.evidenceRefs} onJump={onJumpEvidence} />
            </li>
          ))}
        </ul>
      ) : null}
      {payload?.nextActions?.length ? (
        <div className="amt-next-actions">
          <span className="amt-metric-label">下一步</span>
          <ul className="amt-compact-list">
            {payload.nextActions.map((action) => <li key={action}>{action}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  );
};

export const MetricsSummaryView: React.FC<{ node: AgentNode }> = ({ node }) => {
  const payload = getPayload<MetricsSummaryPayload>(node);
  if (!payload) {
    return null;
  }

  const metrics = [
    ['Depth', payload.depth],
    ['Branching', payload.branchingFactor],
    ['Tool Density', payload.toolDensity],
    ['Traceability', payload.traceabilityScore],
    ['Tokens', payload.tokenOutput.toLocaleString('en-US')],
  ];

  return (
    <section className="amt-metrics" data-testid="agent-timeline-metrics" data-node-id={node.id}>
      <header className="amt-section-header">
        <span className="amt-node-icon" aria-hidden="true">▣</span>
        <strong>{node.title}</strong>
      </header>
      <div className="amt-metric-grid">
        {metrics.map(([label, value]) => (
          <div key={label} className="amt-metric-card">
            <span className="amt-metric-label">{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
};

export const EvidenceView: React.FC<{ node: AgentNode }> = ({ node }) => {
  const payload = getPayload<EvidencePayload>(node);

  return (
    <article className="amt-evidence-source" data-testid="agent-timeline-evidence-source" data-node-id={node.id}>
      <strong>{node.title}</strong>
      <p>{payload?.quote ?? node.summary}</p>
      <span className="amt-muted">{payload?.sourceType ?? 'evidence'} · {payload?.confidence !== undefined ? payload.confidence.toFixed(2) : 'tracked'}</span>
    </article>
  );
};

export const WorkflowStatusGroupView: React.FC<{
  node: AgentNode;
  expanded: boolean;
  onToggle: () => void;
}> = ({ node, expanded, onToggle }) => {
  const payload = getPayload<WorkflowStatusGroupPayload>(node);
  const entries = payload?.entries ?? [];
  const latest = entries[entries.length - 1];
  const summary = node.summary ?? latest?.content ?? '工作流状态已更新。';
  return (
    <section
      className={`amt-workflow-status amt-node-status-${node.status}`}
      data-testid="agent-timeline-workflow-status"
      data-node-id={node.id}
    >
      <header className="amt-workflow-status-header">
        <span className="amt-node-icon" aria-hidden="true">◷</span>
        <strong>工作流状态</strong>
        {entries.length > 1 ? (
          <span className="amt-muted">{entries.length} 项更新</span>
        ) : null}
        <span className="amt-workflow-status-summary">{summary}</span>
        <StatusBadge status={node.status} />
        {entries.length > 0 ? (
          <ExpandButton expanded={expanded} onClick={onToggle} label="切换工作流状态" />
        ) : null}
      </header>
      {expanded && entries.length > 0 ? (
        <ol className="amt-workflow-status-list">
          {entries.map((entry) => (
            <li
              key={entry.messageId}
              className={`amt-workflow-status-item amt-node-status-${entry.status}`}
              data-testid="agent-timeline-workflow-status-entry"
            >
              <span className="amt-muted">{formatStatusEntryTime(entry.createdAt)}</span>
              <span>{entry.content}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
};

export const GenericWorkBlock: React.FC<{
  projection: TimelineProjection;
  node: AgentNode;
  expanded: boolean;
  expandedState: ExpandedState;
  showOnlyFailed: boolean;
  collapseSuccessfulTools: boolean;
  onToggle: (id: string, expanded: boolean) => void;
  onJumpEvidence: (id: string) => void;
  renderChild: (child: AgentNode) => React.ReactNode;
}> = ({
  projection,
  node,
  expanded,
  showOnlyFailed,
  onToggle,
  renderChild,
}) => {
  const children = getChildren(projection, node).filter((child) => shouldShowNode(projection, child, showOnlyFailed));
  const duration = formatDuration(node.metrics?.durationMs);
  const canExpand = node.expandable || children.length > 0;
  const stepPayload = getPayload<StepPayload>(node);
  const phasePayload = getPayload<PhasePayload>(node);

  return (
    <section className={`amt-work-block amt-node-${node.type} amt-node-status-${node.status}`} data-node-id={node.id}>
      <header className="amt-work-block-header">
        <div className="amt-work-block-title">
          <span className="amt-node-marker" aria-hidden="true" />
          <strong>{node.title}</strong>
          <StatusBadge status={node.status} />
        </div>
        <div className="amt-work-block-meta">
          {phasePayload?.progress ? <span>{phasePayload.progress.completed}/{phasePayload.progress.total} 完成</span> : null}
          {duration ? <span>{duration}</span> : null}
          {canExpand ? <ExpandButton expanded={expanded} onClick={() => onToggle(node.id, expanded)} label={`切换 ${node.title}`} /> : null}
        </div>
      </header>
      {node.summary || stepPayload?.objective || phasePayload?.objective ? (
        <p className="amt-work-block-summary">{node.summary ?? stepPayload?.objective ?? phasePayload?.objective}</p>
      ) : null}
      {expanded && children.length > 0 ? (
        <div className="amt-work-block-children">
          {children.map((child) => (
            <React.Fragment key={child.id}>{renderChild(child)}</React.Fragment>
          ))}
        </div>
      ) : null}
    </section>
  );
};
