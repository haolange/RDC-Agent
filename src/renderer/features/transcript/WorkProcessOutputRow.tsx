import React from 'react';
import { MessageMarkdown } from '../../patterns/Markdown/MessageMarkdown';
import type { WorkProcessRow } from './workProcessTypes';

/** One item keeps its React identity when provider evidence resolves its phase. */
export const WorkProcessOutputRow: React.FC<{ row: Extract<WorkProcessRow, { type: 'output' }> }> = ({ row }) => {
  const streaming = row.status === 'running';
  return <li className={`work-process-step work-process-output kind-output-${row.phase ?? 'unknown'}`}
    data-testid="work-process-output" data-output-phase={row.phase ?? 'unknown'}>
    <div className="conversation-bubble conversation-bubble-assistant" data-work-node-prose={row.phase !== 'final_answer' ? '' : undefined}>
      <MessageMarkdown content={row.text} deferHeavyPlugins={streaming} />
      {streaming ? <span className="conversation-streaming-cursor" aria-hidden="true" /> : null}
    </div>
  </li>;
};
