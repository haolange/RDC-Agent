import React, { useEffect, useState } from 'react';
import { TaskDialog } from '../../ui/TaskDialog';
import { bareInvestigationHash, type InvestigationReadIpcResult, type InvestigationReport } from '@shared/types/renderdocInvestigation';
import type { InvestigationArtifactRow } from '@shared/types/trace';
import { useI18n, type TranslationKey } from '../../i18n';
import { copyAppText } from '../../hooks/appShellBridge';
import { readInvestigationArtifact } from './investigationPreviewActions';
import { RightRailReportView } from './RightRailReportView';
import { Button } from '../../ui/Button';
import './RightRailInvestigationPreview.css';

type PreviewStatus = 'empty' | 'loading' | 'ready' | 'degraded' | 'error' | 'hash-mismatch';

const shortHash = (value: string): string => {
  const bare = bareInvestigationHash(value);
  return bare ? `sha256:${bare.slice(0, 12)}` : '';
};

export const RightRailInvestigationPreview: React.FC<{
  sessionId: string;
  row: InvestigationArtifactRow;
  onClose: () => void;
}> = ({ sessionId, row, onClose }) => {
  const { t } = useI18n();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [status, setStatus] = useState<PreviewStatus>(row.contentHash ? 'loading' : 'empty');
  const [result, setResult] = useState<InvestigationReadIpcResult | null>(null);

  useEffect(() => {
    if (!row.contentHash) {
      setStatus('empty');
      setResult(null);
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setResult(null);
    void readInvestigationArtifact({
      sessionId,
      artifactId: row.artifactId,
      expectedHash: row.contentHash,
    })?.then((payload) => {
      if (!payload) {
        if (cancelled) return;
        setStatus('error');
        setResult({ ok: false, status: 'error', errorCode: 'INVESTIGATION_SESSION_DENIED', error: 'investigation:read is unavailable' });
        return;
      }
      if (cancelled) return;
      setResult(payload);
      setStatus(payload.status);
    }).catch((error: unknown) => {
      if (cancelled) return;
      setResult({
        ok: false,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      setStatus('error');
    });
    return () => {
      cancelled = true;
    };
  }, [row.artifactId, row.contentHash, sessionId]);

  const hash = result?.contentHash || row.contentHash;
  const manifest = result?.manifest;
  const heading = manifest?.title || row.title || row.artifactId;
  const statusLabel = t(`control.rightRail.artifacts.preview.state.${status}` as TranslationKey);
  const recordStatus = manifest?.status ?? row.status;
  const body = result?.record
    ? JSON.stringify(result.record, null, 2)
    : '';

  return <TaskDialog open title={heading} onClose={onClose} closeLabel={t('control.rightRail.artifacts.preview.close')}
    size={row.kind === 'report' ? 'lg' : 'md'} dataTestId="investigation-preview" className="investigation-preview-content">
    <div className="investigation-preview-id">
      <code>{row.artifactId}</code>
      <Button variant="ghost" size="sm" onClick={() => {
        void copyAppText(row.artifactId).then(() => setCopyState('copied'), () => setCopyState('failed'));
      }}>{t('control.rightRail.artifacts.copyId')}</Button>
    </div>
    {copyState !== 'idle' && <p role="status">{t(`control.rightRail.browse.copy.${copyState}`)}</p>}
        <dl className="investigation-preview-meta">
          <div>
            <dt>{t('control.rightRail.artifacts.preview.version')}</dt>
            <dd>{manifest?.createdAt ?? row.createdAt}</dd>
          </div>
          <div>
            <dt>{t('control.rightRail.artifacts.preview.status')}</dt>
            <dd>{t(`control.rightRail.artifacts.status.${recordStatus}` as TranslationKey)}</dd>
          </div>
          <div>
            <dt>{t('control.rightRail.artifacts.preview.degraded')}</dt>
            <dd>{t(row.degraded || status === 'degraded'
              ? 'control.rightRail.artifacts.preview.yes'
              : 'control.rightRail.artifacts.preview.no')}</dd>
          </div>
          <div>
            <dt>{t('control.rightRail.artifacts.preview.stateLabel')}</dt>
            <dd>{statusLabel}</dd>
          </div>
        </dl>
        <section className="investigation-preview-hash" aria-label={t('control.rightRail.artifacts.preview.hash')}>
          <strong>{shortHash(hash) || t('control.rightRail.artifacts.preview.hashMissing')}</strong>
          <Button
            variant="ghost"
            size="sm"
            disabled={!hash}
            onClick={() => void copyAppText(hash)}
          >
            {t('control.rightRail.artifacts.preview.copyHash')}
          </Button>
        </section>
        {result?.error ? (
          <p className="investigation-preview-error" role="alert">{result.error}</p>
        ) : null}
        {status === 'loading' ? (
          <p className="investigation-preview-message">{statusLabel}</p>
        ) : null}
        {status === 'empty' ? (
          <p className="investigation-preview-message">{t('control.rightRail.artifacts.preview.empty')}</p>
        ) : null}
        {result?.record && manifest?.kind === 'report' ? (
          <>
            <RightRailReportView report={result.record as InvestigationReport} />
            <details className="investigation-preview-source">
              <summary>{t('control.rightRail.artifacts.preview.rawRecord')}</summary>
              <pre className="investigation-preview-body">{body}</pre>
            </details>
          </>
        ) : body ? <pre className="investigation-preview-body">{body}</pre> : null}
        {manifest?.supersedes ? (
          <p className="investigation-preview-message">
            {t('control.rightRail.artifacts.preview.supersedes', { id: manifest.supersedes })}
          </p>
        ) : null}
  </TaskDialog>;
};

export default RightRailInvestigationPreview;
