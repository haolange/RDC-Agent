import { Button } from '../../../../ui/Button';
import { Checkbox } from '../../../../ui/Checkbox';
import { InlineError } from '../../../../ui/InlineError';
import { Textarea } from '../../../../ui/Textarea';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { useI18n } from '../../../../i18n';
import { ConflictRow } from '../parts/ConflictRow';
import type { useKnowledgeWriteConfirm } from '../useKnowledgeWriteConfirm';
import { WriteConfirmDiff } from './WriteConfirmDiff';

interface WriteConfirmDialogProps {
  write: ReturnType<typeof useKnowledgeWriteConfirm>;
}

/**
 * Target, version, provenance and rollback basis are read-only facts returned
 * by main. Submission stays blocked until the reason is filled, the version is
 * still current, and the user has explicitly ticked the confirmation.
 */
export function WriteConfirmDialog({ write }: WriteConfirmDialogProps) {
  const { t } = useI18n();
  if (!write.open || !write.after) return null;

  const hasContradicts = write.contradicts.length > 0;
  const blocked = Boolean(write.block)
    || write.versionStale
    || !write.packReady
    || !write.changeReason.trim()
    || !write.confirmed
    || (hasContradicts && !write.acknowledgedConflicts);

  const fact = (label: string, value: string) => (
    <div className="knowledge-write-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );

  return (
    <TaskDialog
      open
      size="lg"
      title={t('knowledgeCenter.confirmTitle')}
      description={t('knowledgeCenter.confirmDescription')}
      onClose={write.close}
      closeLabel={t('knowledgeCenter.confirmCancel')}
      busy={write.busy}
      dataTestId="knowledge-center-confirm"
      footer={(
        <>
          <Button variant="ghost" disabled={write.busy} onClick={write.close}>
            {t('knowledgeCenter.confirmCancel')}
          </Button>
          <Button
            variant="primary"
            disabled={blocked || write.busy}
            data-testid="knowledge-center-confirm-submit"
            onClick={() => void write.submit()}
          >
            {t('knowledgeCenter.confirmWrite')}
          </Button>
        </>
      )}
    >
      <dl className="knowledge-write-facts">
        {fact(t('knowledgeCenter.confirmTarget'), `${write.after.spaceId} / ${write.after.relativePath}`)}
        {fact(
          t('knowledgeCenter.confirmProvenance'),
          `${write.after.sourceStatus ?? '—'} · ${write.after.caseId ?? '—'}`,
        )}
        {fact(
          t('knowledgeCenter.confirmVersion'),
          write.after.updatedAt != null ? String(write.after.updatedAt) : '—',
        )}
        {fact(
          t('knowledgeCenter.confirmConflict'),
          hasContradicts ? String(write.contradicts.length) : t('knowledgeCenter.confirmNoConflict'),
        )}
      </dl>

      <section className="knowledge-write-section">
        <h3 className="knowledge-write-section-title">{t('knowledgeCenter.confirmDiff')}</h3>
        <WriteConfirmDiff lines={write.diff} />
      </section>

      {hasContradicts ? (
        <section className="knowledge-write-section">
          <h3 className="knowledge-write-section-title">{t('knowledgeCenter.confirmConflict')}</h3>
          {write.contradicts.map((conflict) => (
            <ConflictRow
              key={`${conflict.leftCardId}:${conflict.rightCardId}`}
              leftCardId={conflict.leftCardId}
              rightCardId={conflict.rightCardId}
            />
          ))}
        </section>
      ) : null}

      <label className="knowledge-center-field">
        <span>{t('knowledgeCenter.confirmChangeReason')}</span>
        <Textarea
          value={write.changeReason}
          disabled={write.busy}
          required
          error={!write.changeReason.trim()}
          onChange={(event) => write.setChangeReason(event.target.value)}
          data-testid="knowledge-center-change-reason"
        />
        <span className="knowledge-write-hint">{t('knowledgeCenter.confirmChangeReasonRequired')}</span>
      </label>

      <details className="knowledge-write-basis">
        <summary>{t('knowledgeCenter.confirmRollbackBasis')}</summary>
        <p className="knowledge-write-basis-value">
          {write.basis ? `${write.basis.hash} · ${write.basis.bytes}` : '—'}
        </p>
        <p className="knowledge-write-hint">{t('knowledgeCenter.confirmNoAutoRollback')}</p>
      </details>

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
    </TaskDialog>
  );
}
