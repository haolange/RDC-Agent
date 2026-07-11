import React from 'react';
import type { TraceArtifactRecord } from '@shared/types/trace';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useI18n } from '../../../i18n';
import { Button } from '../../../ui/Button';
import { PlanArtifactPreview } from './PlanArtifactPreview';

interface TraceArtifactListProps {
  current: TraceArtifactRecord[];
  previous: TraceArtifactRecord[];
}

const isPlanArtifact = (artifact: TraceArtifactRecord): boolean => (
  artifact.type === 'plan'
  || Boolean(artifact.previewMarkdown?.trim())
  || Boolean(artifact.path?.toLowerCase().endsWith('plan.md'))
);

export const TraceArtifactList: React.FC<TraceArtifactListProps> = ({ current, previous }) => {
  const { t } = useI18n();
  if (current.length === 0 && previous.length === 0) {
    return <p className="panel-empty">{t('control.traceEmptyArtifacts')}</p>;
  }

  const renderArtifact = (artifact: TraceArtifactRecord) => {
    const planMarkdown = artifact.previewMarkdown?.trim() || '';
    const showPlanPreview = isPlanArtifact(artifact) && planMarkdown.length > 0;
    return (
      <div
        key={artifact.id}
        className={`trace-lane-artifact-item status-${artifact.status}${showPlanPreview ? ' is-plan' : ''}`}
        data-testid={showPlanPreview ? 'trace-lane-plan-artifact' : 'trace-lane-artifact-item'}
      >
        <div className="trace-lane-artifact-main">
          <span className="trace-lane-artifact-name">{artifact.displayName}</span>
          <span className="trace-lane-artifact-meta">{artifact.type} · {artifact.taskTitle || artifact.traceLaneId}</span>
        </div>
        <div className="trace-lane-artifact-actions">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => artifact.path && void getElectronApi()?.appShell.openPath(artifact.path)}
          >
            {t('control.traceArtifactOpen')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => artifact.path && void getElectronApi()?.appShell.copyText(artifact.path)}
          >
            {t('control.traceArtifactCopyPath')}
          </Button>
          <Button variant="ghost" size="sm" title={artifact.rawRef}>{t('control.traceArtifactRaw')}</Button>
        </div>
        {showPlanPreview ? <PlanArtifactPreview markdown={planMarkdown} /> : null}
      </div>
    );
  };

  return (
    <div className="trace-lane-artifact-list">
      {current.map(renderArtifact)}
      {previous.length > 0 ? (
        <details className="trace-lane-history">
          <summary>{t('control.tracePreviousTasks', { count: previous.length })}</summary>
          {previous.map(renderArtifact)}
        </details>
      ) : null}
    </div>
  );
};

export default TraceArtifactList;
