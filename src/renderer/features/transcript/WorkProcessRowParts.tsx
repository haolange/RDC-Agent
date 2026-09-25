import React from 'react';
import { WorkCardHeader } from './WorkCardHeader';
import { useI18n } from '../../i18n';
import { getRowStatusLabel } from './workProcessStatus';
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
import { useScopedWorkDisclosure } from './ScopedWorkDisclosure';

export const ToolRow: React.FC<{ row: ToolRowModel; extraDetail?: React.ReactNode; density?: 'normal' | 'compact' }> = ({ row, extraDetail, density = 'normal' }) => {
  const { t } = useI18n();
  const label = useWorkProcessLabel();
  const statusLabel = row.status === 'complete' ? '' : label(getRowStatusLabel(row.status));
  const hasDetail = row.previewLines.length > 0
    || Boolean(row.hookDiagnostics?.length)
    || Boolean(row.commandText)
    || Boolean(row.pathChip)
    || Boolean(row.chips?.length)
    || Boolean(row.imagePreviews?.length)
    || Boolean(row.sourcePills?.length && row.family === 'web');
  const hasRaw = row.argsLines.length > 0 || row.rawLines.length > 0;
  const canExpand = hasDetail || hasRaw || Boolean(extraDetail);
  const hasApproval = Boolean(row.approval);
  const diagnosticCaption = row.diagnosticCaption?.trim() || '';
  const hasDiagnostic = row.status === 'error' && Boolean(diagnosticCaption);
  const hookAttention = row.hookDiagnostics?.find((diagnostic) => diagnostic.severity === 'error')
    ?? row.hookDiagnostics?.find((diagnostic) => diagnostic.severity === 'warning');
  // Collapsed by default — including while running — so live CoT stays quiet;
  // users expand individual cards when they want detail / Raw.
  const [expanded, toggleDisclosure] = useScopedWorkDisclosure(`tool-${row.id}`, false);
  const durationTitleFull = row.duration ? `${row.toolName} · ${row.duration}` : row.toolName;
  const verbLabel = label(row.verb);
  const isBackgroundWait = row.toolName === 'background_wait';
  const compact = density === 'compact' || isBackgroundWait;
  const payloadText = row.bodyText?.trim() ?? '';
  const hasPayloadSurface = payloadText.length > 160
    && (row.family === 'shell' || payloadText.startsWith('{') || payloadText.startsWith('[') || payloadText.includes('\n'));

  const toggleExpanded = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canExpand) return;
    toggleDisclosure();
  };

  return (
    <li
      className={`work-process-step is-appear status-${row.status} kind-tool family-${row.family}${compact ? ' is-compact-tool' : ''}`}
      data-testid="work-process-tool-call"
    >
      <WorkProcessRailIcon variant="step" status={row.status} />
      <div className="work-process-step-content">
        <div
          className={`work-process-tool-card status-${row.status}${expanded ? ' is-expanded' : ''}${canExpand ? ' is-expandable' : ''}${compact ? ' is-compact' : ''}${isBackgroundWait ? ' is-background-wait' : ''}${hasPayloadSurface ? ' has-payload' : ''}`}
          data-testid="work-process-tool-card"
          data-family={row.family}
        >
          <WorkCardHeader onClick={toggleExpanded} expanded={canExpand ? expanded : undefined}
            disabled={!canExpand} tooltip={durationTitleFull} duration={row.duration}
            icon={<WorkProcessIcon icon={row.icon} className="work-process-tool-card-icon" />}
            title={verbLabel} status={statusLabel ? <span className={row.status === 'error' ? 'work-process-tool-status-error' : undefined}>{statusLabel}</span> : null} />

          {(!isBackgroundWait || expanded) ? <CardBody row={row} /> : null}

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

          {hookAttention && !expanded ? (
            <div className={`work-process-tool-hook-attention severity-${hookAttention.severity}`}>
              {hookAttention.message}
            </div>
          ) : null}

          {hasApproval ? <ToolApprovalCallout approval={row.approval!} /> : null}

          {expanded ? (
            <div className="work-process-tool-card-expand">
              <FamilyDetail row={row} />
              <RawPanel row={row} />
              {row.hookDiagnostics?.length ? (
                <div className="work-process-tool-hook-details" aria-label={t('chat.workProcessHookDiagnostics')}>
                  <span className="work-process-tool-card-raw-label">{t('chat.workProcessHookDiagnostics')}</span>
                  <ul>{row.hookDiagnostics.map((diagnostic) => (
                    <li key={diagnostic.id} className={`severity-${diagnostic.severity}`}>{diagnostic.message}</li>
                  ))}</ul>
                </div>
              ) : null}
              {extraDetail}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
};

export type { ToolRowModel };
