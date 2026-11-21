import React from 'react';
import { useI18n } from '../../i18n';
import { copyAppText, openAppPath } from '../../hooks/appShellBridge';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import type { TraceArtifactRecord } from '@shared/types/trace';

interface RightRailOutputListProps { current: TraceArtifactRecord[]; previous: TraceArtifactRecord[]; }

const formatSize = (size?: number): string => typeof size !== 'number' ? '' : size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;

const OutputFileGlyph: React.FC = () => (
  <Icon name="file" />
);

export const RightRailOutputList: React.FC<RightRailOutputListProps> = React.memo(({ current, previous }) => {
  const { t } = useI18n();
  return (
    <div className="right-rail-artifact-list">
      {[...current, ...previous].map((artifact) => {
        const failed = artifact.status === 'failed';
        return (
          <article key={artifact.id} className={`right-rail-artifact-row status-${artifact.status}`}>
            <span className="right-rail-artifact-icon" aria-hidden="true"><OutputFileGlyph /></span>
            <span className="right-rail-artifact-copy"><strong title={artifact.displayName}>{artifact.displayName}</strong>{formatSize(artifact.sizeBytes) ? <small>{formatSize(artifact.sizeBytes)}</small> : null}</span>
            <span className="right-rail-output-actions">
              <Button variant="ghost" size="sm" onClick={() => artifact.path && void openAppPath(artifact.path)} disabled={!artifact.path || failed}>{failed ? t('control.rightRail.outputs.missing') : t('control.rightRail.outputs.open')}</Button>
              <Button variant="ghost" size="sm" onClick={() => artifact.path && void copyAppText(artifact.path)} disabled={!artifact.path}>{t('control.rightRail.outputs.copy')}</Button>
            </span>
          </article>
        );
      })}
    </div>
  );
});

export default RightRailOutputList;
