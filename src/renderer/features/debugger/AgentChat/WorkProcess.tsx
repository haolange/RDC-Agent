import React, { useEffect, useMemo, useState } from 'react';
import type { ConversationWorkTrace } from '@shared/types/conversation';
import {
  buildWorkProcessPresentation,
  getRowStatusLabel,
  type WorkProcessRow,
} from './workProcessPresentation';

interface WorkProcessProps {
  trace: ConversationWorkTrace;
}

const SummaryRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'summary' }> }> = ({ row }) => (
  <li className={`work-process-step status-${row.status} kind-summary`} data-testid="work-process-block">
    <span className="work-process-step-rail" aria-hidden="true" />
    <div className="work-process-step-content">
      <p className="work-process-step-summary">{row.text}</p>
      {row.detailLines.length > 0 ? (
        <details className="work-process-row-detail">
          <summary>Details</summary>
          <pre>{row.detailLines.join('\n')}</pre>
        </details>
      ) : null}
    </div>
  </li>
);

const DiagnosticRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'diagnostic' }> }> = ({ row }) => (
  <li
    className={`work-process-step work-process-diagnostic status-${row.status} kind-diagnostic`}
    data-testid="work-process-block"
  >
    <span className="work-process-step-rail" aria-hidden="true" />
    <div className="work-process-step-content">
      <div className="work-process-diagnostic-message">{row.message}</div>
      {row.detailLines.length > 0 ? (
        <details className="work-process-row-detail" open={row.status === 'error'}>
          <summary>Details</summary>
          <pre>{row.detailLines.join('\n')}</pre>
        </details>
      ) : null}
    </div>
  </li>
);

const ToolRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'tool' }> }> = ({ row }) => {
  const detailOpen = row.status === 'running' || row.status === 'error';

  return (
    <li className={`work-process-step status-${row.status} kind-tool`} data-testid="work-process-tool-call">
      <span className="work-process-step-rail" aria-hidden="true" />
      <div className="work-process-step-content">
        <details className={`work-process-tool status-${row.status}`} open={detailOpen}>
          <summary className="work-process-tool-summary">
            <span className="work-process-tool-line">
              <span className="work-process-tool-verb">{row.verb}</span>
              <code className="work-process-tool-name">{row.toolName}</code>
              {row.target ? <span className="work-process-tool-target">{row.target}</span> : null}
            </span>
            <span className="work-process-tool-meta">
              <span>{row.category}</span>
              {row.duration ? <span>{row.duration}</span> : null}
              <span>{getRowStatusLabel(row.status)}</span>
            </span>
          </summary>

          <div className="work-process-tool-body">
            {row.previewLines.length > 0 ? (
              <pre className="work-process-tool-result">{row.previewLines.join('\n')}</pre>
            ) : null}
            {row.argsLines.length > 0 ? (
              <details className="work-process-row-detail">
                <summary>Args</summary>
                <pre>{row.argsLines.join('\n')}</pre>
              </details>
            ) : null}
            {row.rawLines.length > 0 ? (
              <details className="work-process-row-detail">
                <summary>Raw result</summary>
                <pre>{row.rawLines.join('\n')}</pre>
              </details>
            ) : null}
          </div>
        </details>
      </div>
    </li>
  );
};

const renderRow = (row: WorkProcessRow): React.ReactNode => {
  if (row.type === 'tool') return <ToolRow key={row.id} row={row} />;
  if (row.type === 'diagnostic') return <DiagnosticRow key={row.id} row={row} />;
  return <SummaryRow key={row.id} row={row} />;
};

export const WorkProcess: React.FC<WorkProcessProps> = ({ trace }) => {
  const presentation = useMemo(() => buildWorkProcessPresentation(trace), [trace]);
  const [expanded, setExpanded] = useState<boolean>(presentation.defaultExpanded);

  useEffect(() => {
    if (trace.status === 'running' || presentation.important) {
      setExpanded(true);
    }
  }, [trace.status, presentation.important]);

  const stepCopy = presentation.stepCount === 1 ? '1 step' : `${presentation.stepCount} steps`;
  const toolCopy = presentation.toolCount === 1 ? '1 tool' : `${presentation.toolCount} tools`;
  const summaryCopy = presentation.toolCount > 0 ? `${stepCopy} · ${toolCopy}` : stepCopy;

  return (
    <section
      className={`work-process status-${trace.status} ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      data-testid="work-process"
      aria-label="Work Process"
    >
      <button
        type="button"
        className="work-process-header"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
      >
        <span className={`work-process-caret ${expanded ? 'is-open' : ''}`} aria-hidden="true" />
        <span className="work-process-label">工作过程</span>
        <span className="work-process-header-summary">{summaryCopy}</span>
        <span className={`work-process-count status-${trace.status}`}>{presentation.statusLabel}</span>
      </button>

      {expanded ? (
        <div className="work-process-body">
          {presentation.summary ? (
            <p className="work-process-summary">{presentation.summary}</p>
          ) : null}
          {presentation.rows.length === 0 ? (
            <p className="work-process-empty">等待真实 agent 事件。</p>
          ) : (
            <ol className="work-process-steps">
              {presentation.rows.map((row) => renderRow(row))}
            </ol>
          )}
        </div>
      ) : null}
    </section>
  );
};

export default WorkProcess;
