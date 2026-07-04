import React from 'react';
import { getRowStatusLabel, type WorkProcessRow } from './workProcessPresentation';
import { useWorkProcessLabel } from './workProcessUseLabel';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';

type ResponseRowModel = Extract<WorkProcessRow, { type: 'response' }>;

export const ResponseRow: React.FC<{ row: ResponseRowModel }> = ({ row }) => {
  const label = useWorkProcessLabel();
  const statusLabel = row.status === 'complete' ? '' : label(getRowStatusLabel(row.status));
  const hasThinking = row.thinkingExpandable && Boolean(row.thinkingPreview);
  const summaryContent = (
    <>
      <span className="work-process-response-head">
        <span className="work-process-response-title">{label(row.title)}</span>
        <span className="work-process-response-summary-text">{label(row.summary)}</span>
      </span>
      <span className="work-process-tool-meta">
        {row.duration ? <span>{row.duration}</span> : null}
        {statusLabel ? <span>{statusLabel}</span> : null}
        {hasThinking ? <span className="work-process-row-caret" aria-hidden="true" /> : null}
      </span>
    </>
  );

  return (
    <li className={`work-process-step work-process-response status-${row.status} kind-response`} data-testid="work-process-response">
      <WorkProcessRailIcon variant="step" status={row.status} />
      <div className="work-process-step-content">
        {hasThinking ? (
          <details
            className={`work-process-response-details ${[
              row.thinkingKind ? `kind-${row.thinkingKind}` : '',
              row.thinkingVisibility ? `visibility-${row.thinkingVisibility}` : '',
              row.thinkingStatus ? `status-${row.thinkingStatus}` : '',
            ].filter(Boolean).join(' ')}`}
            open={row.thinkingOpenByDefault}
          >
            <summary className="work-process-response-summary">
              {summaryContent}
            </summary>
            <div className="work-process-response-thinking">
              <span className="work-process-response-thinking-label">{label(row.thinkingLabel)}</span>
              <pre className="work-process-thinking-preview">{row.thinkingPreview}</pre>
            </div>
          </details>
        ) : (
          <div className="work-process-response-summary work-process-response-summary-static">
            {summaryContent}
          </div>
        )}
      </div>
    </li>
  );
};
