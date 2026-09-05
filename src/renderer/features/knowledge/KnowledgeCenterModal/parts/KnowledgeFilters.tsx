import { KnowledgeIcon } from './KnowledgeIcon';
import { Button } from '../../../../ui/Button';
import { useI18n } from '../../../../i18n';
import { ALL_CARD_TYPES, ALL_LIFECYCLES } from '../knowledgeCenterModel';
import { TYPE_LABEL_KEYS, LIFECYCLE_LABEL_KEYS, LANE_LABEL_KEYS } from '../knowledgeCenterLabels';
import type { useKnowledgeCenter } from '../useKnowledgeCenter';
import './KnowledgeFilters.css';

export function KnowledgeFilters({ state }: { state: ReturnType<typeof useKnowledgeCenter> }) {
  const { t } = useI18n();
  const groups = [
    { label: t('knowledgeCenter.filterType'), options: ALL_CARD_TYPES.map(id => ({ id, label: t(TYPE_LABEL_KEYS[id]), selected: state.types.includes(id), toggle: () => state.toggleType(id) })) },
    { label: t('knowledgeCenter.filterLifecycle'), options: ALL_LIFECYCLES.map(id => ({ id, label: t(LIFECYCLE_LABEL_KEYS[id]), selected: state.lifecycles.includes(id), toggle: () => state.toggleLifecycle(id) })) },
    { label: t('knowledgeCenter.lanesTitle'), options: state.allLanes.map(id => ({ id, label: t(LANE_LABEL_KEYS[id]), selected: state.lanes.includes(id), toggle: () => state.toggleLane(id) })) },
  ];
  const changed = groups.filter(group => group.options.some(option => !option.selected));
  return (
    <details className="knowledge-filters" onKeyDown={event => {
      if (event.key === 'Escape' && event.currentTarget.open) {
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.open = false;
        event.currentTarget.querySelector('summary')?.focus();
      }
    }}>
      <summary><KnowledgeIcon name="filter" />{t('knowledgeCenter.filters')}
        {changed.length > 0 && <span className="knowledge-filter-count">{changed.length}</span>}
      </summary>
      <div className="knowledge-filter-panel">
        {groups.map(group => (
          <fieldset key={group.label}>
            <legend>{group.label}</legend>
            <div className="knowledge-filter-options">
              {group.options.map(option => <Button key={option.id} variant="ghost" size="sm" aria-pressed={option.selected} onClick={option.toggle}>{option.label}</Button>)}
            </div>
          </fieldset>
        ))}
        {changed.length > 0 && <Button variant="ghost" size="sm" onClick={() => groups.forEach(group => group.options.filter(option => !option.selected).forEach(option => option.toggle()))}>{t('knowledgeCenter.resetFilters')}</Button>}
      </div>
    </details>
  );
}
