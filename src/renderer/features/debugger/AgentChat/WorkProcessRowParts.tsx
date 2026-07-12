import React from 'react';
import { useI18n } from '../../../i18n';
import { getRowStatusLabel } from './workProcessPresentation';
import { WorkProcessIcon } from './WorkProcessIcons';
import { useWorkProcessLabel } from './workProcessUseLabel';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';
import {
  CardBody,
  FamilyDetail,
  RawPanel,
  ToolApprovalCallout,
  type ToolRowModel,
} from './WorkProcessToolCardParts';

export const ToolRow: React.FC<{ row: ToolRowModel }> = ({ row }) => {
  const { t } = useI18n();
  const label = useWorkProcessLabel();
  const statusLabel = row.status === 'complete' ? '' : label(getRowStatusLabel(row.status));
  const hasDetail = row.previewLines.length > 0
    || Boolean(row.commandText)
    || Boolean(row.pathChip && row.family === 'generic')
    || Boolean(row.sourcePills?.length && row.family === 'web');
  const hasRaw = row.argsLines.length > 0 || row.rawLines.length > 0;
  const canExpand = hasDetail || hasRaw;
  const hasApproval = Boolean(row.approval);
  const diagnosticCaption = row.diagnosticCaption?.trim() || '';
  const hasDiagnostic = row.status === 'error' && Boolean(diagnosticCaption);
  // Collapsed by default — including while running — so live CoT stays quiet;
  // users expand individual cards when they want detail / Raw.
  const [expanded, setExpanded] = React.useState(false);
  const durationTitleFull = row.duration ? `${row.toolName} · ${row.duration}` : row.toolName;
  const verbLabel = label(row.verb);

  const toggleExpanded = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canExpand) return;
    setExpanded((open) => !open);
  };

  return (
    <li
      className={`work-process-step is-appear status-${row.status} kind-tool family-${row.family}`}
      data-testid="work-process-tool-call"
    >
      <WorkProcessRailIcon variant="step" status={row.status} />
      <div className="work-process-step-content">
        <div
          className={`work-process-tool-card status-${row.status}${expanded ? ' is-expanded' : ''}${canExpand ? ' is-expandable' : ''}`}
          data-testid="work-process-tool-card"
          data-family={row.family}
        >
          <button
            type="button"
            className="work-process-tool-card-header"
            onClick={toggleExpanded}
            aria-expanded={canExpand ? expanded : undefined}
            disabled={!canExpand}
            title={durationTitleFull}
          >
            <span className="work-process-tool-card-title">
              <WorkProcessIcon icon={row.icon} className="work-process-tool-card-icon" />
              <span className="work-process-tool-card-verb">{verbLabel}</span>
            </span>
            <span className="work-process-tool-card-meta">
              {row.duration ? <span>{row.duration}</span> : null}
              {statusLabel ? (
                row.status === 'error' ? (
                  <span className="work-process-tool-status-error">{statusLabel}</span>
                ) : (
                  <span>{statusLabel}</span>
                )
              ) : null}
              {canExpand ? (
                <span className={`work-process-row-caret${expanded ? ' is-open' : ''}`} aria-hidden="true" />
              ) : null}
            </span>
          </button>

          <CardBody row={row} />

          {hasDiagnostic ? (
            <button
              type="button"
              className={`work-process-tool-diagnostic${expanded ? ' is-open' : ''}`}
              data-testid="work-process-tool-diagnostic"
              aria-expanded={expanded}
              title={t('chat.workProcessShowDiagnostic')}
              onClick={toggleExpanded}
            >
              <span className="work-process-tool-diagnostic-text">{diagnosticCaption}</span>
              {canExpand ? (
                <span className="work-process-tool-diagnostic-action">
                  {expanded ? t('chat.workProcessHideDiagnostic') : t('chat.workProcessShowDiagnostic')}
                </span>
              ) : null}
            </button>
          ) : null}

          {hasApproval ? <ToolApprovalCallout approval={row.approval!} /> : null}

          {expanded ? (
            <div className="work-process-tool-card-expand">
              <FamilyDetail row={row} />
              <RawPanel row={row} />
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
};

export type { ToolRowModel };
