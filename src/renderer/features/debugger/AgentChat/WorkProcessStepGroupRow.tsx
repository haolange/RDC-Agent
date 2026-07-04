import React, { useCallback, useMemo } from 'react';
import { useI18n } from '../../../i18n';
import type { WorkProcessStepGroup } from './workProcessPresentation';
import {
  countGroupActions,
  shouldShowGroupMetrics,
  summarizeGroupDuration,
} from './workProcessGroupMetrics';
import { SEMANTIC_STEP_ICONS } from './workProcessSemanticIcons';
import { useWorkProcessLabel } from './workProcessUseLabel';
import { WorkProcessIcon } from './WorkProcessIcons';
import { WorkProcessRailIcon } from './WorkProcessRailIcon';
import type { WorkProcessRow } from './workProcessTypes';

function getDefaultGroupOpen(group: WorkProcessStepGroup): boolean {
  if (group.status === 'running' || group.status === 'pending') return true;
  if (group.status === 'error') return true;
  if (group.kind === 'interaction') return true;
  return false;
}

interface WorkProcessStepGroupRowProps {
  group: WorkProcessStepGroup;
  isOpen: boolean;
  onToggle: (groupId: string, open: boolean) => void;
  renderRow: (row: WorkProcessRow) => React.ReactNode;
}

export const WorkProcessStepGroupRow: React.FC<WorkProcessStepGroupRowProps> = ({
  group,
  isOpen,
  onToggle,
  renderRow,
}) => {
  const { t } = useI18n();
  const label = useWorkProcessLabel();
  const actionCount = useMemo(() => countGroupActions(group.rows), [group.rows]);
  const duration = useMemo(() => summarizeGroupDuration(group.rows), [group.rows]);
  const showMetrics = useMemo(
    () => shouldShowGroupMetrics(group.rows, group.kind),
    [group.kind, group.rows],
  );
  const summaryPreview = useMemo(() => {
    if (showMetrics) return null;
    const summaryRow = group.rows.find((row): row is Extract<WorkProcessRow, { type: 'summary' }> => (
      row.type === 'summary'
    ));
    return summaryRow?.text?.trim() || null;
  }, [group.rows, showMetrics]);
  const groupTitle = label(group.title);
  const countLabel = t('chat.workProcessGroupActionCount', { count: actionCount });
  const icon = SEMANTIC_STEP_ICONS[group.kind] ?? 'tool';

  const handleToggle = useCallback((event: React.SyntheticEvent<HTMLDetailsElement>) => {
    onToggle(group.id, event.currentTarget.open);
  }, [group.id, onToggle]);

  return (
    <li
      className={`work-process-step work-process-step-group status-${group.status} kind-${group.kind}`}
      data-testid="work-process-step-group"
    >
      <WorkProcessRailIcon variant="step" status={group.status} />
      <div className="work-process-step-content">
        <details
          className="work-process-step-group-details"
          open={isOpen}
          onToggle={handleToggle}
        >
          <summary className="work-process-step-group-summary">
            <span className="work-process-step-group-head">
              <span className="work-process-step-group-icon" aria-hidden="true">
                <WorkProcessIcon icon={icon} />
              </span>
              <span className="work-process-step-group-title">{groupTitle}</span>
              {showMetrics ? (
                <>
                  <span className="work-process-step-group-count">{countLabel}</span>
                  {duration ? <span className="work-process-step-group-duration">{duration}</span> : null}
                </>
              ) : null}
            </span>
            {!showMetrics && summaryPreview ? (
              <span className="work-process-step-group-preview">{summaryPreview}</span>
            ) : null}
            <span className="work-process-row-caret" aria-hidden="true" />
          </summary>
          <div className="work-process-step-group-body">
            {group.groupThinking?.preview ? (
              <details className="work-process-group-thinking">
                <summary className="work-process-group-thinking-summary">
                  <span>{t('chat.workProcessGroupThinking')}</span>
                  <span className="work-process-row-caret" aria-hidden="true" />
                </summary>
                <pre className="work-process-thinking-preview">{group.groupThinking.preview}</pre>
              </details>
            ) : null}
            <ol className="work-process-steps work-process-step-group-list">
              {group.rows.map((row) => renderRow(row))}
            </ol>
          </div>
        </details>
      </div>
    </li>
  );
};

export { getDefaultGroupOpen };
