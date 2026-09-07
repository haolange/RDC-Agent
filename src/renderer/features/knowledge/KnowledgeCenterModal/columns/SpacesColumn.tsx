import { KnowledgeIcon } from '../parts/KnowledgeIcon';
import { Button } from '../../../../ui/Button';
import { EmptyState } from '../../../../ui/EmptyState';
import { InlineError } from '../../../../ui/InlineError';
import { ListRow } from '../../../../ui/ListRow';
import { Panel } from '../../../../ui/Panel';
import { useI18n } from '../../../../i18n';
import { IndexStatusBar } from '../parts/IndexStatusBar';
import type { useKnowledgeCenter } from '../useKnowledgeCenter';

interface SpacesColumnProps { state: ReturnType<typeof useKnowledgeCenter>; onImport: () => void; }

export function SpacesColumn({ state, onImport }: SpacesColumnProps) {
  const { t } = useI18n();
  const views = [
    { id: 'cards', label: 'knowledgeCenter.viewCards', icon: 'book' },
    { id: 'candidates', label: 'knowledgeCenter.viewCandidates', icon: 'inbox' },
    { id: 'conflicts', label: 'knowledgeCenter.viewConflicts', icon: 'conflict' },
  ] as const;
  return (
    <Panel className="knowledge-center-spaces" data-testid="knowledge-center-spaces">
      <div className="knowledge-center-brand">
        <KnowledgeIcon name="book" />
        <div className="knowledge-center-brand-title" id="knowledge-center-title">{t('knowledgeCenter.title')}</div>
      </div>
      <nav className="knowledge-center-navigation" aria-label={t('knowledgeCenter.viewLabel')}>
        {views.map(({ id, label, icon }) => (
          <ListRow
            key={id}
            className="knowledge-center-nav-item"
            selected={state.viewMode === id}
            aria-pressed={state.viewMode === id}
            data-testid={'knowledge-center-view-' + id}
            leading={<KnowledgeIcon name={icon} />}
            onClick={() => state.setViewMode(id)}
          >
            {t(label)}
          </ListRow>
        ))}
      </nav>
      <div className="knowledge-center-section-title">{t('knowledgeCenter.spacesTitle')}</div>
      <div className="knowledge-center-space-list" data-testid="knowledge-center-space-list">
        {state.spaces.length === 0 && (
          <EmptyState className="knowledge-center-empty-inline" title={t('knowledgeCenter.noSpaces')} />
        )}
        {state.spaces.map((space) => (
          <ListRow
            key={space.spaceId}
            className="knowledge-center-nav-item"
            selected={state.selectedSpaceIds.includes(space.spaceId)}
            aria-pressed={state.selectedSpaceIds.includes(space.spaceId)}
            data-testid={'knowledge-space-' + space.spaceId}
            leading={<KnowledgeIcon name="folder" />}
            trailing={<span className="knowledge-center-space-meta">{state.index?.cardsBySpace[space.spaceId] ?? 0}</span>}
            onClick={() => state.toggleSpace(space.spaceId)}
          >
            {space.kind === 'user' ? t('knowledgeCenter.userSpace') : space.label}
          </ListRow>
        ))}
      </div>
      <div className="knowledge-center-sidebar-footer">
        <Button variant="secondary" onClick={onImport} data-testid="knowledge-center-import-open">
          <KnowledgeIcon name="upload" />{t('knowledgeCenter.importColdData')}
        </Button>
        <details className="knowledge-center-index-disclosure">
          <summary>{t('knowledgeCenter.indexTools')}</summary>
          <IndexStatusBar index={state.index} rebuilding={state.rebuilding} onRebuild={() => void state.rebuildIndex()} />
        </details>
      </div>
      {state.error && (
        <InlineError className="knowledge-center-error" data-severity="error" data-testid="knowledge-center-error">
          {state.error}
        </InlineError>
      )}
    </Panel>
  );
}
