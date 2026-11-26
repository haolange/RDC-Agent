import { useState } from 'react';
import { useI18n } from '../../../../i18n';
import { humanizeError } from '../../../../i18n/humanizeError';
import { errorDetail } from '../../../../lib/errorDetail';
import { formatDateTime } from '../../../../lib/formatTime';
import { Button } from '../../../../ui/Button';
import { InlineError } from '../../../../ui/InlineError';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { KnowledgeTaskCancelled, KnowledgeTaskProgress } from '../parts/KnowledgeTaskProgress';
import type { KnowledgeIndexOverview } from '@shared/types/knowledge';
import type { KnowledgeOperationProgress } from '@shared/types/knowledgeOperation';

/**
 * Rebuilding the index is a recovery step, so it lives behind 「⋯」 as a task dialog: one sentence on what it does,
 * the rebuild button and the index facts. While it runs the dialog shows how many cards are indexed and offers
 * Cancel; a cancelled rebuild keeps the dialog open and says the previous index is still in use. If it fails the
 * dialog stays open with the reason and a retry, and it closes only on success.
 */
export function RebuildIndexDialog({
  open,
  index,
  rebuilding,
  progress,
  cancelling,
  onRebuild,
  onCancel,
  onClose,
}: {
  open: boolean;
  index: KnowledgeIndexOverview | null;
  rebuilding: boolean;
  progress: KnowledgeOperationProgress | null;
  cancelling: boolean;
  onRebuild: () => Promise<'rebuilt' | 'cancelled'>;
  onCancel: () => void;
  onClose: () => void;
}) {
  const { t, language } = useI18n();
  const [failure, setFailure] = useState<unknown>(null);
  const [cancelled, setCancelled] = useState(false);
  const close = () => {
    setFailure(null);
    setCancelled(false);
    onClose();
  };
  const rebuild = () => {
    setFailure(null);
    setCancelled(false);
    void onRebuild().then((outcome) => (outcome === 'cancelled' ? setCancelled(true) : close()), setFailure);
  };
  return (
    <TaskDialog
      open={open}
      size="sm"
      title={t('knowledgeCenter.indexRebuild')}
      description={t('knowledgeCenter.indexRebuildHint')}
      closeLabel={t('dialog.cancel')}
      busy={rebuilding}
      onClose={close}
      dataTestId="knowledge-center-rebuild-dialog"
      footer={
        <>
          {rebuilding ? <KnowledgeTaskProgress operation="rebuild" progress={progress} /> : null}
          {!rebuilding && cancelled ? (
            <KnowledgeTaskCancelled label={t('knowledgeCenter.indexRebuildCancelled')} />
          ) : null}
          {rebuilding ? (
            <Button
              variant="secondary"
              loading={cancelling}
              data-testid="knowledge-center-rebuild-cancel"
              onClick={onCancel}
            >
              {t('knowledgeCenter.cancelTask')}
            </Button>
          ) : (
            <Button variant="ghost" onClick={close}>
              {t('dialog.cancel')}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={rebuilding}
            data-testid="knowledge-center-rebuild-confirm"
            onClick={rebuild}
          >
            {rebuilding ? t('knowledgeCenter.indexRebuilding') : t('knowledgeCenter.indexRebuild')}
          </Button>
        </>
      }
    >
      <dl className="knowledge-center-index-facts">
        <div>
          <dt>{t('knowledgeCenter.indexCardCount')}</dt>
          <dd>{index?.cardCount ?? 0}</dd>
        </div>
        <div>
          <dt>{t('knowledgeCenter.indexBuiltAt')}</dt>
          <dd>
            {index?.builtAt
              ? formatDateTime(language, Date.parse(index.builtAt))
              : t('knowledgeCenter.indexNeverBuilt')}
          </dd>
        </div>
      </dl>
      {failure ? (
        <InlineError
          data-testid="knowledge-center-rebuild-error"
          detail={errorDetail(failure)}
          onRetry={rebuild}
          retryDisabled={rebuilding}
        >
          {humanizeError(failure, t, 'knowledgeCenter.indexRebuildFailed')}
        </InlineError>
      ) : null}
    </TaskDialog>
  );
}
