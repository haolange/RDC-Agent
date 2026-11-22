import { useI18n } from '../../../../i18n';
import { Button } from '../../../../ui/Button';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { formatKnowledgeTime } from '../knowledgeCenterLabels';
import type { KnowledgeIndexOverview } from '@shared/types/knowledge';

/**
 * Rebuilding the index is a recovery step, so it lives behind 「⋯」 as a task dialog: one sentence on what it does,
 * the rebuild button, and the index facts (cards, build time, revision) under 诊断.
 */
export function RebuildIndexDialog({ open, index, rebuilding, onRebuild, onClose }: {
  open: boolean;
  index: KnowledgeIndexOverview | null;
  rebuilding: boolean;
  onRebuild: () => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <TaskDialog
      open={open}
      size="sm"
      title={t('knowledgeCenter.indexRebuild')}
      description={t('knowledgeCenter.indexRebuildHint')}
      closeLabel={t('dialog.cancel')}
      busy={rebuilding}
      onClose={onClose}
      dataTestId="knowledge-center-rebuild-dialog"
      footer={(
        <>
          <Button variant="ghost" disabled={rebuilding} onClick={onClose}>{t('dialog.cancel')}</Button>
          <Button variant="primary" disabled={rebuilding} data-testid="knowledge-center-rebuild-confirm"
            onClick={() => void onRebuild().then(onClose)}>
            {rebuilding ? t('knowledgeCenter.indexRebuilding') : t('knowledgeCenter.indexRebuild')}
          </Button>
        </>
      )}
    >
      <dl className="knowledge-center-index-facts">
        <div><dt>{t('knowledgeCenter.indexCardCount')}</dt><dd>{index?.cardCount ?? 0}</dd></div>
        <div>
          <dt>{t('knowledgeCenter.indexBuiltAt')}</dt>
          <dd>{index?.builtAt ? formatKnowledgeTime(Date.parse(index.builtAt)) : t('knowledgeCenter.indexNeverBuilt')}</dd>
        </div>
      </dl>
    </TaskDialog>
  );
}
