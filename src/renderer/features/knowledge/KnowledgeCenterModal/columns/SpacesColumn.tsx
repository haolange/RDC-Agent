import { KnowledgeIcon } from '../parts/KnowledgeIcon';
import { Checkbox } from '../../../../ui/Checkbox';
import { InlineError } from '../../../../ui/InlineError';
import { ListRow } from '../../../../ui/ListRow';
import { Panel } from '../../../../ui/Panel';
import { useI18n } from '../../../../i18n';
import { humanizeError } from '../../../../i18n/humanizeError';
import type { useKnowledgeCenter } from '../useKnowledgeCenter';

interface SpacesColumnProps {
  state: ReturnType<typeof useKnowledgeCenter>;
  candidateCount?: number;
}

export function SpacesColumn({ state, candidateCount }: SpacesColumnProps) {
  const { t } = useI18n();
  // A view shows a count only when there is something in it; spaces appear only when there is a choice to make.
  const views = [
    { id: 'cards', label: 'knowledgeCenter.viewCards', icon: 'book', count: state.index?.cardCount },
    { id: 'candidates', label: 'knowledgeCenter.viewCandidates', icon: 'inbox', count: candidateCount },
    { id: 'conflicts', label: 'knowledgeCenter.viewConflicts', icon: 'conflict', count: state.pack?.conflicts.length },
  ] as const;
  const showSpaces = state.spaces.length > 1 && (state.index?.cardCount ?? 0) > 0;
  return (
    <Panel className="knowledge-center-spaces" data-testid="knowledge-center-spaces">
      <div className="knowledge-center-navigation" role="tablist" aria-label={t('knowledgeCenter.viewLabel')}>
        {views.map(({ id, label, icon, count }) => (
          <ListRow
            key={id}
            className="knowledge-center-nav-item"
            selected={state.viewMode === id}
            role="tab"
            data-testid={'knowledge-center-view-' + id}
            leading={<KnowledgeIcon name={icon} size={16} />}
            trailing={count ? <span className="knowledge-center-nav-count">{count}</span> : undefined}
            onClick={() => state.setViewMode(id)}
          >
            {t(label)}
          </ListRow>
        ))}
      </div>
      {showSpaces ? (
        <>
          <div className="knowledge-center-section-title">{t('knowledgeCenter.spacesTitle')}</div>
          <div
            className="knowledge-center-space-list"
            role="group"
            aria-label={t('knowledgeCenter.spacesTitle')}
            data-testid="knowledge-center-space-list"
          >
            {state.spaces.map((space) => (
              <Checkbox
                key={space.spaceId}
                className="knowledge-center-space-row"
                checked={state.selectedSpaceIds.includes(space.spaceId)}
                onCheckedChange={() => state.toggleSpace(space.spaceId)}
                data-testid={'knowledge-space-' + space.spaceId}
                label={space.kind === 'user' ? t('knowledgeCenter.userSpace') : space.label}
                trailing={
                  <span className="knowledge-center-space-meta">{state.index?.cardsBySpace[space.spaceId] ?? 0}</span>
                }
              />
            ))}
          </div>
        </>
      ) : null}
      {state.error && (
        <InlineError className="knowledge-center-error" data-testid="knowledge-center-error" detail={state.error}>
          {humanizeError(state.error, t, 'app.error.loadFailed')}
        </InlineError>
      )}
    </Panel>
  );
}
