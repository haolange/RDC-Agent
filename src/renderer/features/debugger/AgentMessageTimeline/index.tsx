import React, { useState } from 'react';
import type {
  AgentNode,
  AgentNodeStatus,
  AgentRunPayload,
  ArtifactPayload,
  EvidencePayload,
  FinalAnswerPayload,
  GroupPayload,
  MergePayload,
  MetricsSummaryPayload,
  PhasePayload,
  RawDetailPayload,
  StepPayload,
  SubAgentRunPayload,
  TimelineProjection,
  ToolCallPayload,
} from '@shared/types/agentTimeline';
import type { ConversationMessageDiagnostic } from '@shared/types/conversation';
import './AgentMessageTimeline.css';

interface AgentMessageTimelineProps {
  projections: TimelineProjection[];
  emptyState: React.ReactNode;
}

type ExpandedState = Record<string, boolean>;

interface AssistantMessagePayload {
  diagnostic?: ConversationMessageDiagnostic | null;
}

const statusLabel: Record<AgentNodeStatus, string> = {
  pending: '待处理',
  running: '进行中',
  streaming: '输出中',
  waiting_tool: '等待工具',
  waiting_user: '等待用户',
  merging: '合并中',
  succeeded: '已完成',
  partial_succeeded: '部分完成',
  failed: '失败',
  cancelled: '已取消',
  skipped: '已跳过',
  blocked: '阻塞',
};

const formatTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  });

const formatDuration = (durationMs?: number): string | null => {
  if (!durationMs || durationMs <= 0) {
    return null;
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}分${seconds}秒`;
};

const formatSize = (size?: number): string => {
  if (!size || size <= 0) {
    return '';
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

const hasFailure = (status: AgentNodeStatus): boolean =>
  status === 'failed' || status === 'blocked' || status === 'partial_succeeded';

const titleFromRunStatus = (node: AgentNode, payload?: AgentRunPayload): string => {
  const compact = node.ui?.density === 'compact' || payload?.executionMode === 'single_agent';
  if (node.status === 'running' || node.status === 'streaming' || node.status === 'waiting_tool') {
    return '正在思考';
  }
  if (node.status === 'failed') {
    return compact ? '回复失败' : '执行失败';
  }
  if (node.status === 'blocked') {
    return '等待配置或确认';
  }
  if (node.status === 'partial_succeeded') {
    return '部分完成';
  }
  if (node.status === 'cancelled') {
    return '已停止';
  }
  return '已完成思考';
};

const shouldDefaultExpand = (node: AgentNode, collapseSuccessfulTools: boolean): boolean => {
  if (node.type === 'tool_call' && collapseSuccessfulTools && node.status === 'succeeded') {
    return false;
  }
  if (node.defaultExpanded !== undefined) {
    return node.defaultExpanded;
  }
  return node.status === 'running'
    || node.status === 'streaming'
    || node.status === 'failed'
    || node.status === 'blocked'
    || node.status === 'partial_succeeded'
    || node.type === 'agent_run'
    || node.type === 'phase';
};

const getPayload = <TPayload,>(node: AgentNode): TPayload | undefined => node.payload as TPayload | undefined;

const getChildren = (projection: TimelineProjection, node: AgentNode): AgentNode[] =>
  (node.children ?? [])
    .map((id) => projection.nodes[id])
    .filter(Boolean)
    .sort((left, right) => left.order - right.order);

const nodeHasFailedDescendant = (projection: TimelineProjection, node: AgentNode): boolean => {
  if (hasFailure(node.status)) {
    return true;
  }
  return getChildren(projection, node).some((child) => nodeHasFailedDescendant(projection, child));
};

const shouldShowNode = (projection: TimelineProjection, node: AgentNode, showOnlyFailed: boolean): boolean => {
  if (!showOnlyFailed) {
    return true;
  }
  return nodeHasFailedDescendant(projection, node);
};

const StatusBadge: React.FC<{ status: AgentNodeStatus }> = ({ status }) => (
  <span className={`amt-status amt-status-${status}`}>
    <span className="amt-status-dot" aria-hidden="true" />
    {statusLabel[status]}
  </span>
);

const ExpandButton: React.FC<{
  expanded: boolean;
  onClick: () => void;
  label: string;
}> = ({ expanded, onClick, label }) => (
  <button
    type="button"
    className="amt-icon-button amt-expand-button"
    aria-label={label}
    aria-expanded={expanded}
    onClick={onClick}
  >
    <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
  </button>
);

const EvidenceBadge: React.FC<{
  evidenceRefs: string[];
  onJump: (id: string) => void;
}> = ({ evidenceRefs, onJump }) => {
  if (evidenceRefs.length === 0) {
    return null;
  }

  return (
    <button
      type="button"
      className="amt-evidence-badge"
      data-testid="agent-timeline-evidence-badge"
      onClick={() => onJump(evidenceRefs[0])}
    >
      Evidence ×{evidenceRefs.length}
    </button>
  );
};

const ArtifactGrid: React.FC<{ artifacts: AgentNode[] }> = ({ artifacts }) => {
  if (artifacts.length === 0) {
    return null;
  }

  return (
    <div className="amt-artifact-grid" data-testid="agent-timeline-artifact-grid">
      {artifacts.map((artifact) => {
        const payload = getPayload<ArtifactPayload>(artifact);
        const title = payload?.name ?? artifact.title;
        const size = formatSize(payload?.sizeBytes);
        return (
          <button
            key={artifact.id}
            type="button"
            className="amt-artifact-card"
            data-node-id={artifact.id}
            onClick={() => {
              if (payload?.path) {
                void window.electronAPI?.appShell.openPath(payload.path);
              }
            }}
          >
            <span className="amt-artifact-icon" aria-hidden="true">
              {payload?.artifactType === 'image' || payload?.artifactType === 'screenshot' ? '▧' : '{}'}
            </span>
            <span className="amt-artifact-copy">
              <span className="amt-artifact-name">{title}</span>
              {size ? <span className="amt-artifact-size">{size}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
};

const RawDetailView: React.FC<{ node: AgentNode }> = ({ node }) => {
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

const ToolCallView: React.FC<{
  node: AgentNode;
  expanded: boolean;
  onToggle: () => void;
}> = ({ node, expanded, onToggle }) => {
  const payload = getPayload<ToolCallPayload>(node);
  const duration = formatDuration(node.metrics?.durationMs);
  const inlineSummary = payload?.toolName === 'ui.ask_user_question'
    ? (node.summary || payload?.resultSummary || payload?.argumentsSummary)
    : '';

  return (
    <div className={`amt-tool-call amt-node-status-${node.status}`} data-testid="agent-timeline-tool-call" data-node-id={node.id}>
      <div className="amt-tool-call-header">
        <span className="amt-tool-icon" aria-hidden="true">⌁</span>
        <span className="amt-tool-name">{payload?.toolName ?? node.title}</span>
        {inlineSummary ? <span className="amt-tool-summary">{inlineSummary}</span> : null}
        {duration ? <span className="amt-muted">{duration}</span> : null}
        <StatusBadge status={node.status} />
        <ExpandButton expanded={expanded} onClick={onToggle} label={`切换 ${node.title}`} />
      </div>
      {expanded ? (
        <div className="amt-tool-call-body">
          {payload?.purpose ? <p>{payload.purpose}</p> : null}
          <dl className="amt-key-values">
            <div>
              <dt>输入</dt>
              <dd>{payload?.argumentsSummary || '无参数摘要'}</dd>
            </div>
            <div>
              <dt>输出</dt>
              <dd>{payload?.resultSummary || node.summary || '等待结果'}</dd>
            </div>
          </dl>
          {payload?.argumentsRaw ? <pre>{JSON.stringify(payload.argumentsRaw, null, 2)}</pre> : null}
          {payload?.resultRaw ? <pre>{JSON.stringify(payload.resultRaw, null, 2)}</pre> : null}
          {payload?.stderr ? <pre className="amt-error-block">{payload.stderr}</pre> : null}
        </div>
      ) : null}
    </div>
  );
};

const SubAgentRunView: React.FC<{ node: AgentNode }> = ({ node }) => {
  const payload = getPayload<SubAgentRunPayload>(node);
  const confidence = payload?.confidence !== undefined ? `${Math.round(payload.confidence * 100)}%` : null;

  return (
    <article className={`amt-subagent-card amt-node-status-${node.status}`} data-testid="agent-timeline-subagent" data-node-id={node.id}>
      <div className="amt-subagent-icon" aria-hidden="true">◆</div>
      <div className="amt-subagent-main">
        <div className="amt-subagent-title-row">
          <strong>{payload?.agentName ?? node.title}</strong>
          <StatusBadge status={node.status} />
        </div>
        <p>{payload?.outputSummary ?? node.summary}</p>
        <span className="amt-muted">{payload?.agentRole ?? payload?.objective}</span>
      </div>
      {confidence ? <span className="amt-subagent-confidence">{confidence}</span> : null}
    </article>
  );
};

const MergeView: React.FC<{ node: AgentNode }> = ({ node }) => {
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

const FinalAnswerView: React.FC<{
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

const MetricsSummaryView: React.FC<{ node: AgentNode }> = ({ node }) => {
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

const EvidenceView: React.FC<{ node: AgentNode }> = ({ node }) => {
  const payload = getPayload<EvidencePayload>(node);

  return (
    <article className="amt-evidence-source" data-testid="agent-timeline-evidence-source" data-node-id={node.id}>
      <strong>{node.title}</strong>
      <p>{payload?.quote ?? node.summary}</p>
      <span className="amt-muted">{payload?.sourceType ?? 'evidence'} · {payload?.confidence !== undefined ? payload.confidence.toFixed(2) : 'tracked'}</span>
    </article>
  );
};

const GenericWorkBlock: React.FC<{
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
      ) : null}
    </section>
  );
};

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
            {subAgents.map((child) => <SubAgentRunView key={child.id} node={child} />)}
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

const TimelineNodeView: React.FC<{
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

  if (node.type === 'tool_call') {
    return <ToolCallView node={node} expanded={expanded} onToggle={() => onToggle(node.id, expanded)} />;
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
    return <SubAgentRunView node={node} />;
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
    />
  );
};

const AgentRunView: React.FC<{
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
  const payload = getPayload<AgentRunPayload>(node);
  const children = getChildren(projection, node).filter((child) => shouldShowNode(projection, child, showOnlyFailed));
  const expanded = expandedState[node.id] ?? shouldDefaultExpand(node, collapseSuccessfulTools);
  const duration = formatDuration(node.metrics?.durationMs);
  const isActive = node.status === 'running' || node.status === 'streaming' || node.status === 'waiting_tool';
  const isCompact = node.ui?.density === 'compact' || payload?.executionMode === 'single_agent';
  const progressText = payload?.progress
    ? `${payload.progress.total} 步`
    : `${children.length} 组`;
  const title = titleFromRunStatus(node, payload);

  return (
    <article
      className={`amt-thinking-trace amt-thinking-status-${node.status} ${isActive ? 'is-active' : ''} ${isCompact ? 'is-compact' : ''}`}
      data-testid="agent-thinking-trace"
      data-node-id={node.id}
    >
      <button
        type="button"
        className="amt-thinking-label"
        data-testid="assistant-reasoning-toggle"
        aria-expanded={expanded}
        onClick={() => onToggle(node.id, expanded)}
      >
        <span className="amt-thinking-dot" aria-hidden="true" />
        <span className="amt-thinking-title">
          {title}
          {isActive ? <span className="amt-thinking-ellipsis" aria-hidden="true" /> : null}
        </span>
        <span className="amt-thinking-meta">{progressText}</span>
        {duration ? <span className="amt-thinking-meta">{duration}</span> : null}
        <span className="amt-thinking-chevron" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
      </button>
      <div className="assistant-reasoning-panel-compat" data-testid="assistant-reasoning-panel" aria-hidden="true">
        Reasoning trace
      </div>
      {expanded ? (
        <div className="amt-thinking-area" data-testid="agent-thinking-area">
          <div>
            {node.summary ? <p className="amt-thinking-summary">{node.summary}</p> : null}
            {children.map((child) => (
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
        </div>
      ) : null}
    </article>
  );
};

const UserMessageView: React.FC<{ node: AgentNode }> = ({ node }) => (
  <article className="amt-user-message chat-message user" data-testid="agent-timeline-user-message" data-node-id={node.id}>
    <div className="amt-avatar amt-user-avatar" aria-hidden="true">人</div>
    <div className="amt-user-bubble message-bubble" data-testid="conversation-user-brief">
      <p>{node.summary}</p>
      <span>{formatTime(node.createdAt)}</span>
    </div>
  </article>
);

const AssistantMessageView: React.FC<{ node: AgentNode }> = ({ node }) => {
  const payload = getPayload<AssistantMessagePayload>(node);
  const diagnostic = payload?.diagnostic ?? null;
  const routeLabel = [diagnostic?.providerId, diagnostic?.modelId].filter(Boolean).join('/');

  return (
    <article
      className={`amt-assistant-message chat-message assistant ${diagnostic ? 'has-diagnostic' : ''}`}
      data-testid="agent-timeline-assistant-message"
      data-node-id={node.id}
    >
      <div className="amt-avatar amt-assistant-avatar" aria-hidden="true">A</div>
      <div className="amt-assistant-bubble message-bubble" data-testid="conversation-assistant-card">
        <div data-testid="assistant-document-flow">
          <p>{node.summary}</p>
          {diagnostic ? (
            <div className={`amt-assistant-diagnostic is-${diagnostic.severity}`} data-testid="conversation-message-diagnostic">
              <strong>模型链路诊断</strong>
              <span>{diagnostic.code}</span>
              {routeLabel ? <span>{routeLabel}</span> : null}
              {diagnostic.technicalMessage ? <code>{diagnostic.technicalMessage}</code> : null}
            </div>
          ) : null}
          <span>{formatTime(node.createdAt)}</span>
        </div>
      </div>
    </article>
  );
};

const ProjectionView: React.FC<{
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
          return <UserMessageView key={root.id} node={root} />;
        }
        if (root.type === 'assistant_message') {
          return <AssistantMessageView key={root.id} node={root} />;
        }
        if (root.type === 'agent_run') {
          return (
            <AgentRunView
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

export const AgentMessageTimeline: React.FC<AgentMessageTimelineProps> = ({ projections, emptyState }) => {
  const [expandedState, setExpandedState] = useState<ExpandedState>({});
  const showOnlyFailed = false;
  const collapseSuccessfulTools = true;

  const handleToggle = (id: string, expanded: boolean) => {
    setExpandedState((current) => ({ ...current, [id]: !expanded }));
  };

  const handleJumpEvidence = (id: string) => {
    const target = document.querySelector<HTMLElement>(`[data-node-id="${id}"]`);
    if (!target) {
      return;
    }
    target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    target.classList.add('amt-node-highlight');
    window.setTimeout(() => target.classList.remove('amt-node-highlight'), 1400);
  };

  if (projections.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <section className="agent-message-timeline" data-testid="agent-message-timeline">
      <div className="amt-projections">
        {projections.map((projection) => (
          <ProjectionView
            key={projection.id}
            projection={projection}
            expandedState={expandedState}
            showOnlyFailed={showOnlyFailed}
            collapseSuccessfulTools={collapseSuccessfulTools}
            onToggle={handleToggle}
            onJumpEvidence={handleJumpEvidence}
          />
        ))}
      </div>
    </section>
  );
};

export default AgentMessageTimeline;
