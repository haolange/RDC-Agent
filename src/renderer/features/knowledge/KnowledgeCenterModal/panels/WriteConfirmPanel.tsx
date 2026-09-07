import type { RefObject } from 'react';
import { Button } from '../../../../ui/Button';
import { Checkbox } from '../../../../ui/Checkbox';
import { InlineError } from '../../../../ui/InlineError';
import { Textarea } from '../../../../ui/Textarea';
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
        {write.versionStale && <InlineError>{t('knowledgeCenter.confirmVersionStale')}</InlineError>}
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
        <Textarea
          value={write.changeReason}
          disabled={write.busy}
          required
          onChange={(event) => write.setChangeReason(event.target.value)}
          data-testid="knowledge-center-change-reason"
        />
        {!write.changeReason.trim() && <p>{t('knowledgeCenter.confirmChangeReasonRequired')}</p>}
      </section>
      <section>
        <h3>{t('knowledgeCenter.confirmRollbackBasis')}</h3>
        <p>{write.basis ? `${write.basis.hash} · ${write.basis.bytes}` : '—'}</p>
        <p>{t('knowledgeCenter.confirmNoAutoRollback')}</p>
      </section>
      {write.block === 'draft-to-verified' && <InlineError>{t('knowledgeCenter.confirmBlockedLifecycle')}</InlineError>}
      {write.block?.startsWith('missing-chapters') && <InlineError>{t('knowledgeCenter.confirmMissingChapters')}</InlineError>}
      {write.versionStale && <InlineError>{t('knowledgeCenter.confirmVersionStale')}</InlineError>}
      {write.error && <InlineError>{write.error}</InlineError>}
      <Checkbox
        className="knowledge-center-check"
        checked={write.confirmed}
        disabled={write.busy}
        onCheckedChange={write.setConfirmed}
        data-testid="knowledge-center-explicit-confirm"
        label={t('knowledgeCenter.confirmExplicit')}
      />
      {hasContradicts && (
        <Checkbox
          className="knowledge-center-check"
          checked={write.acknowledgedConflicts}
          disabled={write.busy}
          onCheckedChange={write.setAcknowledgedConflicts}
          data-testid="knowledge-center-acknowledge-conflicts"
          label={t('knowledgeCenter.confirmAcknowledgeConflicts')}
        />
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
