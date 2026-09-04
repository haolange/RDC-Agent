import { Button } from '../../../../ui/Button';
import { useI18n } from '../../../../i18n';
import { ALL_CARD_TYPES, ALL_LIFECYCLES, type KnowledgeViewMode } from '../knowledgeCenterModel';
import { LIFECYCLE_LABEL_KEYS, TYPE_LABEL_KEYS } from '../knowledgeCenterLabels';
import { IndexStatusBar } from '../parts/IndexStatusBar';
import { LaneStatusList } from '../parts/LaneStatusList';
import type { useKnowledgeCenter } from '../useKnowledgeCenter';

interface SpacesColumnProps {
  state: ReturnType<typeof useKnowledgeCenter>;
  onImport: () => void;
}

export function SpacesColumn({ state, onImport }: SpacesColumnProps) {
  const { t } = useI18n();
  const viewLabel: Record<KnowledgeViewMode, 'knowledgeCenter.viewCards' | 'knowledgeCenter.viewCandidates' | 'knowledgeCenter.viewConflicts'> = {
    cards: 'knowledgeCenter.viewCards',
    candidates: 'knowledgeCenter.viewCandidates',
    conflicts: 'knowledgeCenter.viewConflicts',
  };
  return (
    <aside className="knowledge-center-spaces" data-testid="knowledge-center-spaces">
      <div className="knowledge-center-brand">
        <div className="knowledge-center-brand-icon" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15z" />
          </svg>
        </div>
        <div className="knowledge-center-brand-copy">
          <div className="knowledge-center-brand-title" id="knowledge-center-title">{t('knowledgeCenter.title')}</div>
          <div className="knowledge-center-brand-subtitle">{t('knowledgeCenter.subtitle')}</div>
        </div>
      </div>

      <div className="knowledge-center-segmented" role="tablist" aria-label={t('knowledgeCenter.viewLabel')}>
        <Button variant={state.viewMode === 'cards' ? 'primary' : 'secondary'} size="sm" aria-pressed={state.viewMode === 'cards'} data-testid="knowledge-center-view-cards" onClick={() => state.setViewMode('cards')}>
          {t(viewLabel.cards)}
        </Button>
        <Button variant={state.viewMode === 'candidates' ? 'primary' : 'secondary'} size="sm" aria-pressed={state.viewMode === 'candidates'} data-testid="knowledge-center-view-candidates" onClick={() => state.setViewMode('candidates')}>
          {t(viewLabel.candidates)}
        </Button>
        <Button variant={state.viewMode === 'conflicts' ? 'primary' : 'secondary'} size="sm" aria-pressed={state.viewMode === 'conflicts'} data-testid="knowledge-center-view-conflicts" onClick={() => state.setViewMode('conflicts')}>
          {t(viewLabel.conflicts)}
        </Button>
      </div>

      <div className="knowledge-center-section-title">{t('knowledgeCenter.spacesTitle')}</div>
      <div className="knowledge-center-space-list" data-testid="knowledge-center-space-list">
        {state.spaces.length === 0 && (
          <div className="knowledge-center-empty-inline">{t('knowledgeCenter.noSpaces')}</div>
        )}
        {state.spaces.map((space) => {
          const checked = state.selectedSpaceIds.includes(space.spaceId);
          const count = state.index?.cardsBySpace[space.spaceId] ?? 0;
          return (
            <label key={space.spaceId} className="knowledge-center-check" data-testid={`knowledge-space-${space.spaceId}`}>
              <input type="checkbox" checked={checked} onChange={() => state.toggleSpace(space.spaceId)} />
              <span>{space.kind === 'user' ? t('knowledgeCenter.userSpace') : space.label}</span>
              <span className="knowledge-center-space-kind">
                {space.kind === 'user' ? t('knowledgeCenter.scopeUser') : t('knowledgeCenter.scopeProject')}
              </span>
              <span className="knowledge-center-space-meta">{count}</span>
            </label>
          );
        })}
      </div>

      <div className="knowledge-center-section-title">{t('knowledgeCenter.filterType')}</div>
      {ALL_CARD_TYPES.map((type) => (
        <label key={type} className="knowledge-center-check">
          <input type="checkbox" checked={state.types.includes(type)} onChange={() => state.toggleType(type)} />
          <span>{t(TYPE_LABEL_KEYS[type])}</span>
        </label>
      ))}
      <div className="knowledge-center-section-title">{t('knowledgeCenter.filterLifecycle')}</div>
      {ALL_LIFECYCLES.map((lifecycle) => (
        <label key={lifecycle} className="knowledge-center-check">
          <input type="checkbox" checked={state.lifecycles.includes(lifecycle)} onChange={() => state.toggleLifecycle(lifecycle)} />
          <span>{t(LIFECYCLE_LABEL_KEYS[lifecycle])}</span>
        </label>
      ))}

      <LaneStatusList
        lanes={state.allLanes}
        enabled={state.lanes}
        onToggle={state.toggleLane}
      />
      <IndexStatusBar index={state.index} rebuilding={state.rebuilding} onRebuild={() => void state.rebuildIndex()} />
      <Button variant="secondary" onClick={onImport} data-testid="knowledge-center-import-open">
        {t('knowledgeCenter.importColdData')}
      </Button>
      {state.error && (
        <div className="knowledge-center-error" data-severity="error" data-testid="knowledge-center-error" role="alert">
          {state.error}
        </div>
      )}
    </aside>
  );
}
