import React, { useEffect, useState } from 'react';
import { bareInvestigationHash, type InvestigationReadIpcResult, type InvestigationReport } from '@shared/types/renderdocInvestigation';
import { TaskDialog } from '../../ui/TaskDialog';
import { Details } from '../../ui/Details';
import { Badge } from '../../ui/Badge';
import { CopyButton } from '../../ui/CopyButton';
import { Skeleton } from '../../ui/Skeleton';
import { useI18n, type TranslationKey } from '../../i18n';
import { copyAppText } from '../../hooks/appShellBridge';
import { InlineError } from '../../ui/InlineError';
import { errorDetail } from '../../lib/errorDetail';
import { useUiLabels } from '../../lib/useUiLabels';
import { RightRailReportView } from './RightRailReportView';
import { readInvestigationArtifact } from './investigationPreviewActions';
import type { InvestigationArtifactRow } from '@shared/types/trace';
import './RightRailInvestigationPreview.css';

type PreviewStatus = 'empty' | 'loading' | 'ready' | 'degraded' | 'error' | 'hash-mismatch';

const copied = (value: string) => async () => {
  try {
    await copyAppText(value);
    return true;
  } catch {
    return false;
  }
};

/** The sentence a non-report record is about: its statement or summary, whichever it carries. */
const recordText = (record: unknown): string => {
  if (!record || typeof record !== 'object') return '';
  const fields = record as Record<string, unknown>;
  const text = [fields.statement, fields.summary].find((value) => typeof value === 'string' && value.trim());
  return typeof text === 'string' ? text.trim() : '';
};

/**
 * An investigation record opens on its content: the report, or the record's own statement. A record that failed its
 * integrity check says so first and loudly. Ids, the hash, timestamps and the raw JSON stay under the one「诊断」.
 */
export const RightRailInvestigationPreview: React.FC<{
  sessionId: string;
  row: InvestigationArtifactRow;
  onClose: () => void;
}> = ({ sessionId, row, onClose }) => {
  const { t } = useI18n();
  const labels = useUiLabels();
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
      if (cancelled) return;
      if (!payload) {
        setStatus('error');
        setResult({ ok: false, status: 'error', errorCode: 'INVESTIGATION_SESSION_DENIED', error: 'investigation:read is unavailable' });
        return;
      }
      setResult(payload);
      setStatus(payload.status);
    }).catch((error: unknown) => {
      if (cancelled) return;
      setResult({ ok: false, status: 'error', error: errorDetail(error) });
      setStatus('error');
    });
    return () => {
      cancelled = true;
    };
  }, [row.artifactId, row.contentHash, sessionId]);

  const hash = result?.contentHash || row.contentHash;
  const manifest = result?.manifest;
  const heading = manifest?.title || row.title || t(`control.rightRail.artifacts.kind.${row.kind}` as TranslationKey);
  const recordStatus = manifest?.status ?? row.status;
  const integrityFailed = status === 'hash-mismatch' || status === 'degraded' || row.degraded;
  const statement = manifest?.kind === 'report' ? '' : recordText(result?.record);
  const bareHash = bareInvestigationHash(hash);

  return <TaskDialog open title={heading} onClose={onClose} closeLabel={t('control.rightRail.artifacts.preview.close')}
    size={row.kind === 'report' ? 'lg' : 'md'} dataTestId="investigation-preview" className="investigation-preview-content">
    <div className="investigation-preview-status">
      <Badge variant="outline">{t(`control.rightRail.artifacts.status.${recordStatus}` as TranslationKey)}</Badge>
    </div>
    {integrityFailed ? (
      <InlineError data-testid="investigation-preview-integrity" detail={result?.error}>
        {t(status === 'hash-mismatch' ? 'control.rightRail.artifacts.preview.integrity.hashMismatch' : 'control.rightRail.artifacts.preview.integrity.degraded')}
      </InlineError>
    ) : null}
    {status === 'error' ? <InlineError detail={result?.error}>{t('app.error.loadFailed')}</InlineError> : null}
    {status === 'loading' ? <Skeleton count={4} /> : null}
    {status === 'empty' ? <p className="investigation-preview-message">{t('control.rightRail.artifacts.preview.empty')}</p> : null}
    {result?.record && manifest?.kind === 'report' ? <RightRailReportView report={result.record as InvestigationReport} /> : null}
    {statement ? <p className="investigation-preview-statement">{statement}</p> : null}
    <Details className="investigation-preview-diagnostics" summary={labels.diagnostics}>
      <dl className="investigation-preview-meta">
        <div>
          <dt>ID</dt>
          <dd><code>{row.artifactId}</code><CopyButton onCopy={copied(row.artifactId)}
            label={t('control.rightRail.artifacts.copyId')} copiedLabel={t('control.rightRail.artifacts.copied')} /></dd>
        </div>
        <div>
          <dt>{t('control.rightRail.artifacts.preview.hash')}</dt>
          <dd>{bareHash ? <><code>{`sha256:${bareHash}`}</code><CopyButton onCopy={copied(hash)}
            label={t('control.rightRail.artifacts.preview.copyHash')} copiedLabel={t('control.rightRail.artifacts.copied')} /></>
            : t('control.rightRail.artifacts.preview.hashMissing')}</dd>
        </div>
        <div>
          <dt>{t('control.rightRail.artifacts.preview.version')}</dt>
          <dd>{manifest?.createdAt ?? row.createdAt}</dd>
        </div>
        <div>
          <dt>{t('control.rightRail.artifacts.preview.stateLabel')}</dt>
          <dd>{t(`control.rightRail.artifacts.preview.state.${status}` as TranslationKey)}</dd>
        </div>
        {manifest?.supersedes ? (
          <div>
            <dt>{t('control.rightRail.artifacts.preview.supersedes')}</dt>
            <dd><code>{manifest.supersedes}</code></dd>
          </div>
        ) : null}
      </dl>
      {result?.record ? <pre className="investigation-preview-body">{JSON.stringify(result.record, null, 2)}</pre> : null}
    </Details>
  </TaskDialog>;
};

export default RightRailInvestigationPreview;
