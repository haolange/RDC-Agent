import React from 'react';
import { useI18n } from '../../i18n';
import { OverflowFade } from '../../ui/OverflowFade';
import type { ToolOutcome } from './workProcessOutcome';

export const ToolOutcomeSummary: React.FC<{ outcome: ToolOutcome }> = ({ outcome }) => {
  const { t } = useI18n();
  let title: string;
  let meta = '';
  if (outcome.type === 'investigation') {
    const kind = outcome.kind ? t(`control.rightRail.artifacts.kind.${outcome.kind}`) : '';
    title = outcome.title || kind || t('chat.toolOutcomeArtifact');
    meta = [outcome.title ? kind : '', outcome.status ? t(`control.rightRail.artifacts.status.${outcome.status}`) : ''].filter(Boolean).join(' · ');
  } else if (outcome.type === 'completion') {
    title = t(`chat.toolOutcomeCompletion.${outcome.disposition}`);
  } else {
    title = outcome.names.join('、') || t('chat.toolOutcomeNoTools');
    meta = t('chat.toolOutcomeToolsCount', { count: outcome.count });
  }
  return <div className="work-process-tool-card-body work-process-outcome">
    <span className="work-process-outcome-title"><OverflowFade text={title} /></span>
    {meta ? <span className="work-process-outcome-meta">{meta}</span> : null}
  </div>;
};
