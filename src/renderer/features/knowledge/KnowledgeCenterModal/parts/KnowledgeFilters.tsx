import { useState } from 'react';
import { Button } from '../../../../ui/Button';
import { CheckPill } from '../../../../ui/CheckPill';
import { Icon } from '../../../../ui/Icon';
import { Popover } from '../../../../ui/Popover';
import { useI18n } from '../../../../i18n';
import { ALL_CARD_TYPES, ALL_LIFECYCLES } from '../knowledgeCenterModel';
import { TYPE_LABEL_KEYS, LIFECYCLE_LABEL_KEYS, LANE_LABEL_KEYS } from '../knowledgeCenterLabels';
import type { useKnowledgeCenter } from '../useKnowledgeCenter';
import './KnowledgeFilters.css';

/**
 * Type, lifecycle and the six retrieval lanes come straight from the shared
 * enums; this panel never introduces filters the query service cannot honour.
 */
export function KnowledgeFilters({ state }: { state: ReturnType<typeof useKnowledgeCenter> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const groups = [
    {
      id: 'type',
      label: t('knowledgeCenter.filterType'),
      options: ALL_CARD_TYPES.map((id) => ({
        id,
        label: t(TYPE_LABEL_KEYS[id]),
        selected: state.types.includes(id),
        toggle: () => state.toggleType(id),
      })),
    },
    {
      id: 'lifecycle',
      label: t('knowledgeCenter.filterLifecycle'),
      options: ALL_LIFECYCLES.map((id) => ({
        id,
        label: t(LIFECYCLE_LABEL_KEYS[id]),
        selected: state.lifecycles.includes(id),
        toggle: () => state.toggleLifecycle(id),
      })),
    },
    {
      id: 'lane',
      label: t('knowledgeCenter.lanesTitle'),
      options: state.allLanes.map((id) => ({
        id,
        label: t(LANE_LABEL_KEYS[id]),
        selected: state.lanes.includes(id),
        toggle: () => state.toggleLane(id),
      })),
    },
  ];

  const narrowed = groups.filter((group) => group.options.some((option) => !option.selected));

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      className="knowledge-filter-popover"
      trigger={(
        <Button
          variant="secondary"
          size="sm"
          className="knowledge-filter-trigger"
          data-testid="knowledge-center-filters"
        >
          <Icon name="filter" size={14} />
          {t('knowledgeCenter.filters')}
          {narrowed.length > 0 ? (
            <span className="knowledge-filter-count">{narrowed.length}</span>
          ) : null}
        </Button>
      )}
    >
      <div className="knowledge-filter-header">
        <span className="knowledge-filter-title">{t('knowledgeCenter.filters')}</span>
        <Button
          variant="ghost"
          size="sm"
          disabled={narrowed.length === 0}
          data-testid="knowledge-center-filters-reset"
          onClick={() => groups.forEach((group) => group.options
            .filter((option) => !option.selected)
            .forEach((option) => option.toggle()))}
        >
          {t('knowledgeCenter.resetFilters')}
        </Button>
      </div>
      {groups.map((group) => (
        <fieldset key={group.id} className="knowledge-filter-group">
          <legend>{group.label}</legend>
          <div className="knowledge-filter-options">
            {group.options.map((option) => (
              <CheckPill
                key={option.id}
                checked={option.selected}
                onCheckedChange={option.toggle}
                data-testid={`knowledge-filter-${group.id}-${option.id}`}
              >
                {option.label}
              </CheckPill>
            ))}
          </div>
        </fieldset>
      ))}
    </Popover>
  );
}
