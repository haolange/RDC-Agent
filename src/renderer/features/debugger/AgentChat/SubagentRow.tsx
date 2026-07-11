import React, { useState } from 'react';
import type { WorkProcessRow } from './workProcessPresentation';
import { getRowStatusLabel } from './workProcessPresentation';

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
  // 子 row 渲染委托回 WorkProcess 的 renderRow（避免循环 import，用 lazy require 模式）
  // 这里用简化渲染：tool/summary/diagnostic 各自轻量展示
  if (row.type === 'tool') {
    return (
      <li key={row.id} className={`work-process-child-tool status-${row.status}`}>
        <span className="work-process-child-verb">{row.verb}</span>
        <span className="work-process-child-target">{row.target || row.toolName}</span>
        {row.duration ? <span className="work-process-child-duration">{row.duration}</span> : null}
      </li>
    );
  }
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
  if (row.type === 'task') {
    return (
      <li key={row.id} className={`work-process-child-summary status-${row.status}`}>
        <span className="work-process-child-text">{row.title}</span>
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
  if (row.type === 'reasoningIndicator') {
    return (
      <li key={row.id} className={`work-process-child-reasoning-indicator status-${row.status} state-${row.state}`} />
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
