import { useEffect, useState } from 'react';
import { Button } from '../../../../ui/Button';
import { Icon } from '../../../../ui/Icon';
import { IconButton } from '../../../../ui/IconButton';
import { useI18n } from '../../../../i18n';
import type { KnowledgeIndexOverview } from '@shared/types/knowledge';
import { formatKnowledgeTime } from '../knowledgeCenterLabels';

interface IndexStatusBarProps {
  index: KnowledgeIndexOverview | null;
  rebuilding: boolean;
  onRebuild: () => void;
}

/**
 * Index maintenance (collapsed by default in the Spaces column): current state, card
 * count, build time, full revision with copy, and a secondary rebuild action.
 */
export function IndexStatusBar({ index, rebuilding, onRebuild }: IndexStatusBarProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyRevision = () => {
    if (!index?.revision) return;
    void navigator.clipboard?.writeText(index.revision).then(() => setCopied(true));
  };

  const state = rebuilding
    ? t('knowledgeCenter.indexRebuilding')
    : index ? t('knowledgeCenter.indexReady') : t('knowledgeCenter.indexNeverBuilt');

  return (
    <div className="knowledge-center-index" data-testid="knowledge-center-index" data-state={rebuilding ? 'rebuilding' : index ? 'ready' : 'empty'}>
      <p className="knowledge-center-index-hint">{t('knowledgeCenter.indexHint')}</p>
      <dl className="knowledge-center-index-stats">
        <div>
          <dt>{t('knowledgeCenter.indexStatus')}</dt>
          <dd className="knowledge-center-index-state">
            <span className="knowledge-center-index-dot" aria-hidden="true" />
            {state}
          </dd>
        </div>
        <div>
          <dt>{t('knowledgeCenter.indexCardCount')}</dt>
          <dd>{index?.cardCount ?? 0}</dd>
        </div>
        <div>
          <dt>{t('knowledgeCenter.indexBuiltAt')}</dt>
          <dd title={index?.builtAt}>{index?.builtAt ? formatKnowledgeTime(Date.parse(index.builtAt)) : t('knowledgeCenter.indexNeverBuilt')}</dd>
        </div>
      </dl>
      <div className="knowledge-center-index-revision">
        <span className="knowledge-center-index-label">{t('knowledgeCenter.indexRevision')}</span>
        <code className="knowledge-center-index-revision-value" title={index?.revision}>{index?.revision ?? '—'}</code>
        <IconButton
          label={copied ? t('knowledgeCenter.indexCopied') : t('knowledgeCenter.indexCopyRevision')}
          size="sm"
          disabled={!index?.revision}
          onClick={copyRevision}
          data-testid="knowledge-center-index-copy"
        >
          <Icon name={copied ? 'check' : 'copy'} size={14} />
        </IconButton>
      </div>
      <div className="knowledge-center-index-actions">
        <Button variant="secondary" size="sm" onClick={onRebuild} disabled={rebuilding} data-testid="knowledge-center-rebuild">
          {rebuilding ? t('knowledgeCenter.indexRebuilding') : t('knowledgeCenter.indexRebuild')}
        </Button>
        <span className="knowledge-center-index-note">{t('knowledgeCenter.indexRebuildHint')}</span>
      </div>
    </div>
  );
}
