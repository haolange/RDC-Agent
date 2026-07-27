import React from 'react';
import type { TraceArtifactRecord } from '@shared/types/trace';
import { getElectronApi } from '../../../platform/getElectronApi';
import { Button } from '../../../ui/Button';

interface TraceArtifactListProps { current: TraceArtifactRecord[]; previous: TraceArtifactRecord[]; }

const formatSize = (size?: number): string => typeof size !== 'number' ? '' : size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;

const OutputFileGlyph: React.FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 3.5h7l5 5V20.5H6z" />
    <path d="M13 3.5v5h5M9 14h6M9 17h4" />
  </svg>
);

export const TraceArtifactList: React.FC<TraceArtifactListProps> = ({ current, previous }) => (
  <div className="right-rail-artifact-list">
    {[...current, ...previous].map((artifact) => {
      const failed = artifact.status === 'failed';
      return (
        <article key={artifact.id} className={`right-rail-artifact-row status-${artifact.status}`}>
          <span className="right-rail-artifact-icon" aria-hidden="true"><OutputFileGlyph /></span>
          <span className="right-rail-artifact-copy"><strong title={artifact.displayName}>{artifact.displayName}</strong>{formatSize(artifact.sizeBytes) ? <small>{formatSize(artifact.sizeBytes)}</small> : null}</span>
          <span className="right-rail-output-actions"><Button variant="ghost" size="sm" onClick={() => artifact.path && void getElectronApi()?.appShell.openPath(artifact.path)} disabled={!artifact.path || failed}>{failed ? 'Missing' : 'Open'}</Button><Button variant="ghost" size="sm" onClick={() => artifact.path && void getElectronApi()?.appShell.copyText(artifact.path)} disabled={!artifact.path}>Copy</Button></span>
        </article>
      );
    })}
  </div>
);

export default TraceArtifactList;
