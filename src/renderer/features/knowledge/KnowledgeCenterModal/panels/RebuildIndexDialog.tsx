import { useState } from 'react';
import { useI18n } from '../../../../i18n';
import { humanizeError } from '../../../../i18n/humanizeError';
import { errorDetail } from '../../../../lib/errorDetail';
import { formatDateTime } from '../../../../lib/formatTime';
import { Button } from '../../../../ui/Button';
import { InlineError } from '../../../../ui/InlineError';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { KnowledgeTaskProgress } from '../parts/KnowledgeTaskProgress';
import type { KnowledgeIndexOverview } from '@shared/types/knowledge';

/**
 * Rebuilding the index is a recovery step, so it lives behind 「⋯」 as a task dialog: one sentence on what it does,
 * the rebuild button and the index facts. While it runs the dialog says so; if it fails the dialog stays open with the
 * reason and a retry, and it closes only on success.
 */
export function RebuildIndexDialog({ open, index, rebuilding, onRebuild, onClose }: {
  open: boolean;
  index: KnowledgeIndexOverview | null;
  rebuilding: boolean;
  onRebuild: () => Promise<void>;
  onClose: () => void;
}) {
  const { t, language } = useI18n();
  const [failure, setFailure] = useState<unknown>(null);
  const close = () => {
    setFailure(null);
    onClose();
  };
  const rebuild = () => {
    setFailure(null);
    void onRebuild().then(close, setFailure);
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
      footer={(
        <>
          {rebuilding ? <KnowledgeTaskProgress label={t('knowledgeCenter.progressRebuilding')} /> : null}
          <Button variant="ghost" disabled={rebuilding} onClick={close}>{t('dialog.cancel')}</Button>
          <Button variant="primary" disabled={rebuilding} data-testid="knowledge-center-rebuild-confirm" onClick={rebuild}>
            {rebuilding ? t('knowledgeCenter.indexRebuilding') : t('knowledgeCenter.indexRebuild')}
          </Button>
        </>
      )}
    >
      <dl className="knowledge-center-index-facts">
        <div><dt>{t('knowledgeCenter.indexCardCount')}</dt><dd>{index?.cardCount ?? 0}</dd></div>
        <div>
          <dt>{t('knowledgeCenter.indexBuiltAt')}</dt>
          <dd>{index?.builtAt ? formatDateTime(language, Date.parse(index.builtAt)) : t('knowledgeCenter.indexNeverBuilt')}</dd>
        </div>
      </dl>
      {failure ? (
        <InlineError data-testid="knowledge-center-rebuild-error" detail={errorDetail(failure)} onRetry={rebuild}
          retryDisabled={rebuilding}>
          {humanizeError(failure, t, 'knowledgeCenter.indexRebuildFailed')}
        </InlineError>
      ) : null}
    </TaskDialog>
  );
}
