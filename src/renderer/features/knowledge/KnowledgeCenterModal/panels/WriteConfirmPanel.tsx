import type { RefObject } from 'react';
import { Button } from '../../../../ui/Button';
import { useI18n } from '../../../../i18n';
import { ConflictRow } from '../parts/ConflictRow';
import type { useKnowledgeWriteConfirm } from '../useKnowledgeWriteConfirm';
import { WriteConfirmDiff } from './WriteConfirmDiff';

interface WriteConfirmPanelProps {
  write: ReturnType<typeof useKnowledgeWriteConfirm>;
  panelRef: RefObject<HTMLDivElement>;
}

export function WriteConfirmPanel({ write, panelRef }: WriteConfirmPanelProps) {
  const { t } = useI18n();
  if (!write.open || !write.after) return null;
  const hasContradicts = write.contradicts.length > 0;
  const blocked = Boolean(write.block)
    || write.versionStale
    || !write.packReady
    || !write.changeReason.trim()
    || !write.confirmed
    || (hasContradicts && !write.acknowledgedConflicts);
  return (
    <div
      ref={panelRef}
      className="knowledge-center-sheet"
      data-confirmation-dialog
      data-testid="knowledge-center-confirm"
      tabIndex={-1}
      aria-busy={write.busy || undefined}
    >
      <h2>{t('knowledgeCenter.confirmTitle')}</h2>
      <section>
        <h3>{t('knowledgeCenter.confirmTarget')}</h3>
        <p>{write.after.spaceId} / {write.after.relativePath}</p>
      </section>
      <section>
        <h3>{t('knowledgeCenter.confirmDiff')}</h3>
        <WriteConfirmDiff lines={write.diff} />
      </section>
      <section>
        <h3>{t('knowledgeCenter.confirmProvenance')}</h3>
        <p>{write.after.sourceStatus ?? '—'} · {write.after.caseId ?? '—'}</p>
      </section>
      <section>
        <h3>{t('knowledgeCenter.confirmVersion')}</h3>
        <p>{write.after.updatedAt ?? '—'}</p>
      </section>
      <section>
        <h3>{t('knowledgeCenter.confirmConflict')}</h3>
        {write.versionStale && <p className="knowledge-center-error">{t('knowledgeCenter.confirmVersionStale')}</p>}
        {write.contradicts.map((conflict) => (
          <ConflictRow
            key={`${conflict.leftCardId}:${conflict.rightCardId}`}
            leftCardId={conflict.leftCardId}
            rightCardId={conflict.rightCardId}
          />
        ))}
        {!write.versionStale && !hasContradicts && <p>{t('knowledgeCenter.confirmNoConflict')}</p>}
      </section>
      <section>
        <h3>{t('knowledgeCenter.confirmChangeReason')}</h3>
        <textarea
          value={write.changeReason}
          disabled={write.busy}
          onChange={(event) => write.setChangeReason(event.target.value)}
          required
          data-testid="knowledge-center-change-reason"
        />
        {!write.changeReason.trim() && <p>{t('knowledgeCenter.confirmChangeReasonRequired')}</p>}
      </section>
      <section>
        <h3>{t('knowledgeCenter.confirmRollbackBasis')}</h3>
        <p>{write.basis ? `${write.basis.hash} · ${write.basis.bytes}` : '—'}</p>
        <p>{t('knowledgeCenter.confirmNoAutoRollback')}</p>
      </section>
      {write.block === 'draft-to-verified' && <p className="knowledge-center-error">{t('knowledgeCenter.confirmBlockedLifecycle')}</p>}
      {write.block?.startsWith('missing-chapters') && <p className="knowledge-center-error">{t('knowledgeCenter.confirmMissingChapters')}</p>}
      {write.versionStale && <p className="knowledge-center-error">{t('knowledgeCenter.confirmVersionStale')}</p>}
      {write.error && <p className="knowledge-center-error" role="alert">{write.error}</p>}
      <label className="knowledge-center-check">
        <input
          type="checkbox"
          checked={write.confirmed}
          disabled={write.busy}
          onChange={(event) => write.setConfirmed(event.target.checked)}
          data-testid="knowledge-center-explicit-confirm"
        />
        <span>{t('knowledgeCenter.confirmExplicit')}</span>
      </label>
      {hasContradicts && (
        <label className="knowledge-center-check">
          <input
            type="checkbox"
            checked={write.acknowledgedConflicts}
            disabled={write.busy}
            onChange={(event) => write.setAcknowledgedConflicts(event.target.checked)}
            data-testid="knowledge-center-acknowledge-conflicts"
          />
          <span>{t('knowledgeCenter.confirmAcknowledgeConflicts')}</span>
        </label>
      )}
      <div className="knowledge-center-sheet-actions">
        <Button variant="primary" disabled={blocked || write.busy} onClick={() => void write.submit()}>
          {t('knowledgeCenter.confirmWrite')}
        </Button>
        <Button variant="secondary" disabled={write.busy} onClick={write.close}>{t('knowledgeCenter.confirmCancel')}</Button>
      </div>
    </div>
  );
}
