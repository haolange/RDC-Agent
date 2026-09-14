import React, { useState } from 'react';
import type { WorkProcessRow } from './workProcessPresentation';
import { getRowStatusLabel } from './workProcessPresentation';
import { ToolRow } from './WorkProcessRowParts';
import { TaskSnapshotCard } from './TaskSnapshotCard';

interface SubagentRowProps {
  row: Extract<WorkProcessRow, { type: 'subagent' }>;
}

/**
 * Subagent row：渲染子 agent 的嵌套工作过程。
 *
 * 可折叠，展开后递归渲染 children rows（复用 WorkProcess 的 row 渲染）。
 * 左侧色带 + 缩进区分层级，避免视觉混乱。
 */
export const SubagentRow: React.FC<SubagentRowProps> = ({ row }) => {
  const [expanded, setExpanded] = useState(row.status === 'running');
  const statusLabel = getRowStatusLabel(row.status);
  const hasChildren = row.children.length > 0;

  return (
    <li className={`work-process-subagent status-${row.status}`} data-work-process-block-id={row.id}>
      <button
        type="button"
        className="work-process-subagent-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span className={`work-process-subagent-caret ${expanded ? 'is-open' : ''}`} aria-hidden="true" />
        <span className="work-process-subagent-profile">{row.profile}</span>
        {row.summary ? <span className="work-process-subagent-summary">{row.summary}</span> : null}
        {statusLabel ? <span className={`work-process-subagent-status status-${row.status}`}>{statusLabel}</span> : null}
        {row.duration ? <span className="work-process-subagent-duration">{row.duration}</span> : null}
      </button>
      {expanded && hasChildren ? (
        <ol className="work-process-subagent-children">
          {row.children.map((child) => renderChildRow(child))}
        </ol>
      ) : null}
    </li>
  );
};

const renderChildRow = (row: WorkProcessRow): React.ReactNode => {
  if (row.type === 'tool') return <ToolRow key={row.id} row={row} />;
  if (row.type === 'taskSnapshot') return <TaskSnapshotCard key={row.id} row={row} />;
  if (row.type === 'subagent') {
    return <SubagentRow key={row.id} row={row} />;
  }
  if (row.type === 'diagnostic') {
    return (
      <li key={row.id} className={`work-process-child-diagnostic status-${row.status}`}>
        <span className="work-process-child-message">{row.message}</span>
      </li>
    );
  }
  if (row.type === 'planReview') {
    return (
      <li key={row.id} className={`work-process-child-summary status-${row.status}`}>
        <span className="work-process-child-text">{row.plan.title}</span>
      </li>
    );
  }
  if (row.type === 'userInput') {
    const summary = row.items.map((item) => item.prompt).filter(Boolean).join(' · ');
    return (
      <li key={row.id} className={`work-process-child-summary status-${row.status}`}>
        <span className="work-process-child-text">{summary}</span>
      </li>
    );
  }
  if (row.type === 'approval') {
    return (
      <li key={row.id} className={`work-process-child-summary status-${row.status}`}>
        <span className="work-process-child-text">{row.message}</span>
      </li>
    );
  }
  if (row.type === 'section') {
    // 子 agent 的简化扁平视图：把小节内步骤直接展开为子 row。
    return (
      <React.Fragment key={row.id}>
        {row.visibleSteps.map((step) => renderChildRow(step))}
      </React.Fragment>
    );
  }
  if (row.type === 'summary') {
    return (
      <li key={row.id} className={`work-process-child-summary status-${row.status}`}>
        <span className="work-process-child-text">{row.text}</span>
      </li>
    );
  }
  return null;
};
