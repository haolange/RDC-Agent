import React from 'react';
import { ModeGlyph } from '../../ui/ModeGlyph';
import { useI18n } from '../../i18n';
import { getRowStatusLabel } from './workProcessStatus';
import { useSubagentDisclosure } from './useSubagentDisclosure';
import { useSubagentRow } from './useSubagentRow';
import { subagentStatusLabelKey, type SubagentWorkRow } from './subagentRowModel';
import { SubagentRowBody } from './SubagentRowBody';
import { WorkCardHeader } from './WorkCardHeader';
import { SubagentProgressDots } from './SubagentProgressDots';
import { FadingPreview } from './WorkDisclosure';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';

export const SubagentRow: React.FC<{ row: SubagentWorkRow; sessionId?: string | null }> = ({ row, sessionId }) => {
  const { t } = useI18n();
  const disclosure = useSubagentDisclosure(sessionId, row.id);
  const { expanded, workOpen, openCard } = disclosure;
  const contentId = React.useId();
  const state = useSubagentRow(row, sessionId, expanded && workOpen, workOpen);
  const { status, active, headerLoading, definition, mode } = state;
  const statusKey = subagentStatusLabelKey(status);
  const progressDots = (
    <SubagentProgressDots state={active ? 'active' : status === 'complete' ? 'complete' : 'stopped'} />
  );
  return (
    <li className="work-process-step kind-subagent" data-work-process-block-id={row.id}>
      <WorkProcessRailIcon row={row} active={status === 'running'} />
      <div
        className={`work-process-step-content work-process-subagent is-${status}${expanded ? ' is-expanded' : ''}`}
        data-testid="work-process-subagent"
        data-locate
      >
        <WorkCardHeader
          onClick={() => openCard(active)}
          expanded={expanded}
          controls={contentId}
          icon={<ModeGlyph mode={mode} icon={definition?.icon ?? undefined} className="work-process-tool-card-icon" />}
          title={state.agentLabel}
          titleMeta={state.routeLabel ? <span className="work-process-subagent-route">{state.routeLabel}</span> : null}
          duration={headerLoading ? undefined : state.duration}
          status={
            <span className={`work-process-subagent-status is-${status}`}>
              {statusKey ? t(statusKey) : getRowStatusLabel('running', t)}
            </span>
          }
          preview={expanded ? undefined : <FadingPreview text={state.task} />}
          trailingPreview={expanded ? undefined : progressDots}
        />
        {expanded ? (
          <SubagentRowBody id={contentId} row={row} sessionId={sessionId} state={state} disclosure={disclosure} />
        ) : null}
      </div>
    </li>
  );
};
