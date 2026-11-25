import { DiffBlock } from '../../../../ui/DiffBlock';
import { Button } from '../../../../ui/Button';
import { Checkbox } from '../../../../ui/Checkbox';
import { InlineError } from '../../../../ui/InlineError';
import { Textarea } from '../../../../ui/Textarea';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { CopyDiagnosticsMenu } from '../../../../patterns/CopyDiagnostics';
import { useI18n } from '../../../../i18n';
import { humanizeError } from '../../../../i18n/humanizeError';
import { ConflictRow } from '../parts/ConflictRow';
import { KnowledgeStatusTag } from '../parts/KnowledgeStatusTag';
import { formatDateTime } from '../../../../lib/formatTime';
import type { ReactNode } from 'react';
import type { KnowledgeSpace } from '@shared/types/knowledge';
import type { useKnowledgeWriteConfirm } from '../useKnowledgeWriteConfirm';

interface WriteConfirmDialogProps {
  write: ReturnType<typeof useKnowledgeWriteConfirm>;
  spaces: readonly KnowledgeSpace[];
}

/**
 * Target, version, provenance and rollback basis are read-only facts returned
 * by main. Submission stays blocked until the reason is filled, the version is
 * still current, and the user has explicitly ticked the confirmation.
 */
export function WriteConfirmDialog({ write, spaces }: WriteConfirmDialogProps) {
  const { t, language } = useI18n();
  if (!write.open || !write.after) return null;

  const space = spaces.find(({ spaceId }) => spaceId === write.after?.spaceId);
  const spaceLabel = space?.kind === 'user' ? t('knowledgeCenter.userSpace') : space?.label;
  const hasContradicts = write.contradicts.length > 0;
  const conflictHit = (id: string) => write.after?.cardId === id
    ? write.after : write.conflictHits.find((hit) => hit.cardId === id);
  const blocked = Boolean(write.block)
    || write.versionStale
    || !write.packReady
    || !write.changeReason.trim()
    || !write.confirmed
    || (hasContradicts && !write.acknowledgedConflicts);

  const fact = (label: string, value: ReactNode) => (
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
      headerActions={write.basis ? (
        <CopyDiagnosticsMenu facts={[
          { label: t('knowledgeCenter.confirmTarget'), value: `${write.after.spaceId} / ${write.after.relativePath}` },
          { label: t('knowledgeCenter.confirmRollbackBasis'), value: write.basis.hash },
          { label: 'bytes', value: write.basis.bytes },
        ]} />
      ) : undefined}
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
        {fact(t('knowledgeCenter.confirmTarget'), [write.after.title, spaceLabel].filter(Boolean).join(' · '))}
        {fact(
          t('knowledgeCenter.confirmCurrentStatus'),
          <KnowledgeStatusTag lifecycle={write.before?.lifecycle} sourceStatus={write.before?.sourceStatus} />,
        )}
        {fact(
          t('knowledgeCenter.confirmVersion'),
          formatDateTime(language, write.after.updatedAt) || '—',
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
              left={conflictHit(conflict.leftCardId)}
              right={conflictHit(conflict.rightCardId)}
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

      <p className="knowledge-write-hint">{t('knowledgeCenter.confirmNoAutoRollback')}</p>

      {write.block === 'draft-to-verified' && <InlineError>{t('knowledgeCenter.confirmBlockedLifecycle')}</InlineError>}
      {write.block?.startsWith('missing-chapters') && <InlineError>{t('knowledgeCenter.confirmMissingChapters')}</InlineError>}
      {write.versionStale && <InlineError>{t('knowledgeCenter.confirmVersionStale')}</InlineError>}
      {write.error && <InlineError detail={write.error}>{humanizeError(write.error, t, 'app.error.actionFailed')}</InlineError>}

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
