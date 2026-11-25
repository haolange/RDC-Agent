import React from 'react';
import { bareInvestigationHash, type InvestigationReadIpcResult, type InvestigationReport } from '@shared/types/renderdocInvestigation';
import { TaskDialog } from '../../ui/TaskDialog';
import { Badge } from '../../ui/Badge';
import { Skeleton } from '../../ui/Skeleton';
import { useI18n, type TranslationKey } from '../../i18n';
import { InlineError } from '../../ui/InlineError';
import { CopyDiagnosticsButton } from '../../patterns/CopyDiagnostics';
import { errorDetail } from '../../lib/errorDetail';
import { useAsyncValue } from '../../lib/useAsyncValue';
import { RightRailReportView } from './RightRailReportView';
import { readInvestigationArtifact } from './investigationPreviewActions';
import type { InvestigationArtifactRow } from '@shared/types/trace';
import './RightRailInvestigationPreview.css';

type PreviewStatus = 'empty' | 'loading' | 'ready' | 'degraded' | 'error' | 'hash-mismatch';


/** The sentence a non-report record is about: its statement or summary, whichever it carries. */
const recordText = (record: unknown): string => {
  if (!record || typeof record !== 'object') return '';
  const fields = record as Record<string, unknown>;
  const text = [fields.statement, fields.summary].find((value) => typeof value === 'string' && value.trim());
  return typeof text === 'string' ? text.trim() : '';
};

/**
 * An investigation record opens on its content: the report, or the record's own statement. A record that failed its
 * integrity check says so first and loudly. The id, hash, version time, load state and superseded record are not
 * shown; the copy-diagnostics button carries them.
 */
export const RightRailInvestigationPreview: React.FC<{
  sessionId: string;
  row: InvestigationArtifactRow;
  onClose: () => void;
}> = ({ sessionId, row, onClose }) => {
  const { t } = useI18n();
  const read = useAsyncValue(
    row.contentHash ? JSON.stringify([sessionId, row.artifactId, row.contentHash]) : null,
    async (): Promise<InvestigationReadIpcResult> => {
      const payload = await readInvestigationArtifact({ sessionId, artifactId: row.artifactId, expectedHash: row.contentHash! });
      return payload ?? { ok: false, status: 'error', errorCode: 'INVESTIGATION_SESSION_DENIED', error: 'investigation:read is unavailable' };
    },
  );
  const result: InvestigationReadIpcResult | null = read.status === 'ready' ? read.value
    : read.status === 'error' ? { ok: false, status: 'error', error: errorDetail(read.error) } : null;
  const status: PreviewStatus = read.status === 'idle' ? 'empty' : read.status === 'loading' ? 'loading' : result!.status;

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
    <CopyDiagnosticsButton className="investigation-preview-copy-diagnostics" facts={[
      { label: 'ID', value: row.artifactId },
      { label: t('control.rightRail.artifacts.preview.hash'), value: bareHash ? `sha256:${bareHash}` : null },
      { label: t('control.rightRail.artifacts.preview.version'), value: manifest?.createdAt ?? row.createdAt },
      { label: t('control.rightRail.artifacts.preview.stateLabel'), value: status },
      { label: t('control.rightRail.artifacts.preview.supersedes'), value: manifest?.supersedes },
    ]} />
  </TaskDialog>;
};

export default RightRailInvestigationPreview;
