import React from 'react';
import { useI18n } from '../../../i18n';
import type { WorkProcessRow } from './workProcessPresentation';

export const WorkProcessReasoningIndicatorRow: React.FC<{
  row: Extract<WorkProcessRow, { type: 'reasoningIndicator' }>;
}> = ({ row }) => {
  const { t } = useI18n();

  return (
    <li
      className={`work-process-step work-process-reasoning-indicator status-${row.status} state-${row.state}`}
      data-testid="work-process-reasoning-indicator"
    >
      <div className="work-process-reasoning-indicator-text">
        {t('chat.workProcessInternalReasoning')}
      </div>
    </li>
  );
};
