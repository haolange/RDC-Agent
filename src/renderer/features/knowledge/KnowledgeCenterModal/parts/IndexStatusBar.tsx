import { Button } from '../../../../ui/Button';
import { useI18n } from '../../../../i18n';
import type { KnowledgeIndexOverview } from '@shared/types/knowledge';

interface IndexStatusBarProps {
  index: KnowledgeIndexOverview | null;
  rebuilding: boolean;
  onRebuild: () => void;
}

export function IndexStatusBar({ index, rebuilding, onRebuild }: IndexStatusBarProps) {
  const { t } = useI18n();
  return (
    <div className="knowledge-center-index" data-testid="knowledge-center-index">
      <div className="knowledge-center-index-meta">
        <span>{t('knowledgeCenter.indexRevision')}: {index ? index.revision.slice(0, 8) : '—'}</span>
        <span>{t('knowledgeCenter.indexBuiltAt')}: {index?.builtAt ?? t('knowledgeCenter.indexNeverBuilt')}</span>
        <span>{t('knowledgeCenter.indexCardCount')}: {index?.cardCount ?? 0}</span>
      </div>
      <Button variant="secondary" size="sm" onClick={onRebuild} disabled={rebuilding} data-testid="knowledge-center-rebuild">
        {rebuilding ? t('knowledgeCenter.indexRebuilding') : t('knowledgeCenter.indexRebuild')}
      </Button>
      <p className="knowledge-center-index-hint">{t('knowledgeCenter.indexSemanticHint')}</p>
    </div>
  );
}
