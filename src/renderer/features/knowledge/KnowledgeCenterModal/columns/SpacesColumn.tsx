import { KnowledgeIcon } from '../parts/KnowledgeIcon';
import { Checkbox } from '../../../../ui/Checkbox';
import { EmptyState } from '../../../../ui/EmptyState';
import { InlineError } from '../../../../ui/InlineError';
import { ListRow } from '../../../../ui/ListRow';
import { Panel } from '../../../../ui/Panel';
import { useI18n } from '../../../../i18n';
import { IndexStatusBar } from '../parts/IndexStatusBar';
import type { useKnowledgeCenter } from '../useKnowledgeCenter';

interface SpacesColumnProps { state: ReturnType<typeof useKnowledgeCenter>; }

export function SpacesColumn({ state }: SpacesColumnProps) {
  const { t } = useI18n();
  const views = [
    { id: 'cards', label: 'knowledgeCenter.viewCards', icon: 'book' },
    { id: 'candidates', label: 'knowledgeCenter.viewCandidates', icon: 'inbox' },
    { id: 'conflicts', label: 'knowledgeCenter.viewConflicts', icon: 'conflict' },
  ] as const;
  return (
    <Panel className="knowledge-center-spaces" data-testid="knowledge-center-spaces">
      <div className="knowledge-center-navigation" role="tablist" aria-label={t('knowledgeCenter.viewLabel')}>
        {views.map(({ id, label, icon }) => (
          <ListRow
            key={id}
            className="knowledge-center-nav-item"
            selected={state.viewMode === id}
            role="tab"
            data-testid={'knowledge-center-view-' + id}
            leading={<KnowledgeIcon name={icon} size={16} />}
            onClick={() => state.setViewMode(id)}
          >
            {t(label)}
          </ListRow>
        ))}
      </div>
      <div className="knowledge-center-section-title">{t('knowledgeCenter.spacesTitle')}</div>
      <div
        className="knowledge-center-space-list"
        role="group"
        aria-label={t('knowledgeCenter.spacesTitle')}
        data-testid="knowledge-center-space-list"
      >
        {state.spaces.length === 0 && (
          <EmptyState className="knowledge-center-empty-inline" title={t('knowledgeCenter.noSpaces')} />
        )}
        {state.spaces.map((space) => (
          <Checkbox
            key={space.spaceId}
            className="knowledge-center-space-row"
            checked={state.selectedSpaceIds.includes(space.spaceId)}
            onCheckedChange={() => state.toggleSpace(space.spaceId)}
            data-testid={'knowledge-space-' + space.spaceId}
            label={space.kind === 'user' ? t('knowledgeCenter.userSpace') : space.label}
            trailing={state.index ? (
              <span className="knowledge-center-space-meta">{state.index.cardsBySpace[space.spaceId] ?? 0}</span>
            ) : undefined}
          />
        ))}
      </div>
      <div className="knowledge-center-sidebar-footer">
        <details className="knowledge-center-index-disclosure" data-testid="knowledge-center-index-tools">
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
