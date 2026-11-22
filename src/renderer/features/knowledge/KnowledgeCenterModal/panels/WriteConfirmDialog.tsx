import { DiffBlock } from '../../../../ui/DiffBlock';
import { Button } from '../../../../ui/Button';
import { Checkbox } from '../../../../ui/Checkbox';
import { InlineError } from '../../../../ui/InlineError';
import { Textarea } from '../../../../ui/Textarea';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { CopyDiagnosticsButton } from '../../../../patterns/CopyDiagnostics';
import { useI18n } from '../../../../i18n';
import { ConflictRow } from '../parts/ConflictRow';
import { formatKnowledgeTime } from '../knowledgeCenterLabels';
import type { useKnowledgeWriteConfirm } from '../useKnowledgeWriteConfirm';

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
          formatKnowledgeTime(write.after.updatedAt) || '—',
        )}
        {fact(
          t('knowledgeCenter.confirmConflict'),
          hasContradicts ? String(write.contradicts.length) : t('knowledgeCenter.confirmNoConflict'),
        )}
      </dl>

      <section className="knowledge-write-section">
        <h3 className="knowledge-write-section-title">{t('knowledgeCenter.confirmDiff')}</h3>
        <DiffBlock lines={write.diff} beforeLabel={t('knowledgeCenter.diffBefore')} afterLabel={t('knowledgeCenter.diffAfter')} dataTestId="knowledge-center-confirm-diff" />
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

      <p className="knowledge-write-hint knowledge-write-rollback">
        {t('knowledgeCenter.confirmNoAutoRollback')}
        {write.basis ? (
          <CopyDiagnosticsButton facts={[
            { label: t('knowledgeCenter.confirmRollbackBasis'), value: write.basis.hash },
            { label: 'bytes', value: write.basis.bytes },
          ]} />
        ) : null}
      </p>

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
