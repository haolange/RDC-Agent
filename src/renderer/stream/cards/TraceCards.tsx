import React, { useState } from 'react';
import type {
  TimelineNode,
  TaskFrameNode,
  ThoughtSummaryNode,
  ToolActionNode,
  PlanNode,
  PhaseGroupNode,
  ObservationNode,
  FindingNode,
  ArtifactNode,
  ApprovalNode,
  ErrorNode,
  SubAgentNode,
  FinalResponseNode,
} from '@shared/types/agenticTrace';
import type { TraceRendererProps } from '../renderer-registry';
import { PreviewView } from '../previews/PreviewViews';
import { resolveRenderer } from '../renderer-registry';

const payloadOf = <T,>(node: TimelineNode): T => node.payload as T;

const StatusDot: React.FC<{ status?: string }> = ({ status }) => (
  <span className={`trace-status-dot status-${status ?? 'pending'}`} aria-hidden="true" />
);

export const TaskFrameCard: React.FC<TraceRendererProps> = ({ node }) => {
  const data = payloadOf<TaskFrameNode>(node);
  return (
    <article className="trace-card trace-task-frame" data-testid="trace-task-frame" data-node-id={node.nodeId}>
      <header><h3>{data.title}</h3></header>
      <p className="trace-task-request">{data.userRequest}</p>
      {data.contextSummary ? <p className="trace-muted">{data.contextSummary}</p> : null}
      {data.constraints?.length ? (
        <ul className="trace-constraints">{data.constraints.map((c) => <li key={c}>{c}</li>)}</ul>
      ) : null}
    </article>
  );
};

export const ThoughtSummaryCard: React.FC<TraceRendererProps> = ({ node }) => {
  const data = payloadOf<ThoughtSummaryNode>(node);
  const text = [data.intent, data.nextAction ? `下一步我会${data.nextAction}` : ''].filter(Boolean).join(' ');
  return (
    <article className="trace-card trace-thought-summary" data-testid="trace-thought-summary" data-node-id={node.nodeId}>
      <p>{text}</p>
    </article>
  );
};

export const PlanCard: React.FC<TraceRendererProps> = ({ node }) => {
  const data = payloadOf<PlanNode>(node);
  const [expanded, setExpanded] = useState(true);
  return (
    <article className="trace-card trace-plan" data-testid="trace-plan-card" data-node-id={node.nodeId}>
      <header>
        <h4>{data.title || '执行计划'}</h4>
        <button type="button" onClick={() => setExpanded((v) => !v)}>{expanded ? '⌃' : '⌄'}</button>
      </header>
      {expanded ? (
        <ol className="trace-plan-steps">
          {data.steps.map((step) => (
            <li key={step.id} className={`status-${step.status}`}>
              <strong>{step.title}</strong>
              {step.description ? <p>{step.description}</p> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </article>
  );
};

export const PhaseGroupCard: React.FC<TraceRendererProps> = ({ node, depth = 0, onSelect }) => {
  const data = payloadOf<PhaseGroupNode>(node);
  const [expanded, setExpanded] = useState(!node.collapsedByDefault);
  return (
    <section
      className="trace-card trace-phase-group"
      data-testid="trace-phase-group"
      data-node-id={node.nodeId}
      style={{ marginLeft: `${depth * 12}px` }}
    >
      <header>
        <button type="button" className="trace-phase-toggle" onClick={() => setExpanded((v) => !v)}>
          <StatusDot status={node.status} />
          <strong>{data.title}</strong>
          <span>{expanded ? '⌃' : '⌄'}</span>
        </button>
      </header>
      {expanded && node.children?.map((child) => {
        const ChildRenderer = resolveRenderer(child.renderer);
        return (
          <div key={child.nodeId} style={{ marginLeft: `${(depth + 1) * 12}px` }}>
            <ChildRenderer node={child} depth={depth + 1} onSelect={onSelect} />
          </div>
        );
      })}
    </section>
  );
};

export const ToolActionCard: React.FC<TraceRendererProps> = ({ node, onSelect }) => {
  const data = payloadOf<ToolActionNode>(node);
  const [expanded, setExpanded] = useState(data.status === 'failed');
  const [tab, setTab] = useState<'summary' | 'preview' | 'raw'>('summary');
  return (
    <article
      className={`trace-card trace-tool-action status-${data.status}`}
      data-testid="trace-tool-action"
      data-node-id={node.nodeId}
    >
      <button type="button" className="trace-tool-head" onClick={() => setExpanded((v) => !v)}>
        <StatusDot status={data.status} />
        <span className="trace-tool-title">{data.displayName}</span>
        {data.inputPreview ? <span className="trace-tool-target">{data.inputPreview}</span> : null}
        {data.durationMs ? <span className="trace-tool-duration">{Math.round(data.durationMs)}ms</span> : null}
        <span>{expanded ? '⌃' : '⌄'}</span>
      </button>
      {expanded ? (
        <div className="trace-tool-detail">
          <div className="trace-tabs">
            {(['summary', 'preview', 'raw'] as const).map((entry) => (
              <button key={entry} type="button" className={tab === entry ? 'active' : ''} onClick={() => setTab(entry)}>
                {entry}
              </button>
            ))}
          </div>
          {tab === 'summary' ? <p>{data.outputPreview || data.purpose || '完成'}</p> : null}
          {tab === 'preview' && data.preview ? <PreviewView preview={data.preview} /> : null}
          {tab === 'raw' ? (
            <pre className="trace-raw-json">{JSON.stringify({ toolName: data.toolName, rawInput: data.rawInput, rawOutput: data.rawOutput }, null, 2)}</pre>
          ) : null}
          <button type="button" className="trace-inspector-link" onClick={() => onSelect?.(node.nodeId)}>Inspector</button>
        </div>
      ) : null}
    </article>
  );
};

export const ObservationCard: React.FC<TraceRendererProps> = ({ node }) => {
  const data = payloadOf<ObservationNode>(node);
  return (
    <article className="trace-card trace-observation" data-testid="trace-observation" data-node-id={node.nodeId}>
      <h4>{data.title}</h4>
      <dl>{data.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
    </article>
  );
};

export const FindingCard: React.FC<TraceRendererProps> = ({ node }) => {
  const data = payloadOf<FindingNode>(node);
  return (
    <article className={`trace-card trace-finding severity-${data.severity}`} data-testid="trace-finding" data-node-id={node.nodeId}>
      <h4>{data.title}</h4>
      <p>{data.diagnosis}</p>
      {data.recommendation ? <p className="trace-muted">{data.recommendation}</p> : null}
    </article>
  );
};

export const ArtifactCard: React.FC<TraceRendererProps> = ({ node }) => {
  const data = payloadOf<ArtifactNode>(node);
  return (
    <article className="trace-card trace-artifact" data-testid="trace-artifact" data-node-id={node.nodeId}>
      <h4>{data.title}</h4>
      {data.preview ? <PreviewView preview={data.preview} /> : null}
    </article>
  );
};

export const ApprovalCard: React.FC<TraceRendererProps> = ({ node }) => {
  const data = payloadOf<ApprovalNode>(node);
  return (
    <article className="trace-card trace-approval" data-testid="trace-approval" data-node-id={node.nodeId}>
      <h4>{data.title}</h4>
      <p>{data.description}</p>
      <span className="trace-risk">风险: {data.riskLevel}</span>
      <div className="trace-approval-actions">
        {data.proposedActions.map((action) => (
          <button key={action.id} type="button" className={`trace-btn ${action.style}`}>{action.label}</button>
        ))}
      </div>
    </article>
  );
};

export const ErrorCard: React.FC<TraceRendererProps> = ({ node }) => {
  const data = payloadOf<ErrorNode>(node);
  return (
    <article className="trace-card trace-error" data-testid="trace-error" data-node-id={node.nodeId}>
      <h4>{data.title}</h4>
      <p>{data.message}</p>
      {data.retryAction ? <button type="button">{data.retryAction.label}</button> : null}
    </article>
  );
};

export const SubAgentCard: React.FC<TraceRendererProps> = ({ node }) => {
  const data = payloadOf<SubAgentNode>(node);
  const [expanded, setExpanded] = useState(false);
  return (
    <article className="trace-card trace-sub-agent" data-testid="trace-sub-agent" data-node-id={node.nodeId}>
      <button type="button" onClick={() => setExpanded((v) => !v)}>
        <StatusDot status={data.status} />
        <strong>{data.title}</strong>
        <span>{expanded ? '⌃' : '⌄'}</span>
      </button>
      {expanded ? (
        <div>
          {data.inputSummary ? <p>{data.inputSummary}</p> : null}
          {data.outputSummary ? <p>{data.outputSummary}</p> : null}
        </div>
      ) : null}
    </article>
  );
};

export const FinalResponseCard: React.FC<TraceRendererProps> = ({ node }) => {
  const data = payloadOf<FinalResponseNode>(node);
  return (
    <article className="trace-card trace-final-response" data-testid="trace-final-response" data-node-id={node.nodeId}>
      <div className="trace-final-content">{data.content}</div>
    </article>
  );
};

export const GenericTraceCard: React.FC<TraceRendererProps> = ({ node }) => (
  <article className="trace-card trace-generic" data-node-id={node.nodeId}>
    <strong>{node.title}</strong>
    {node.subtitle ? <p>{node.subtitle}</p> : null}
  </article>
);
