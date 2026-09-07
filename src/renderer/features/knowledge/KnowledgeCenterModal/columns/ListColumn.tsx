import type { KnowledgeCandidatesResult, KnowledgeLaneHit } from '@shared/types/knowledge';
import { cn } from '../../../../lib/cn';
import { EmptyState } from '../../../../ui/EmptyState';
import { ListRow } from '../../../../ui/ListRow';
import { Panel } from '../../../../ui/Panel';
import { SearchField } from '../../../../ui/SearchField';
import { useI18n, type TranslationKey } from '../../../../i18n';
import { CardBadges } from '../parts/CardBadges';
import { KnowledgeFilters } from '../parts/KnowledgeFilters';
import { ConflictRow } from '../parts/ConflictRow';
import type { useKnowledgeCenter } from '../useKnowledgeCenter';

interface ListColumnProps {
  state: ReturnType<typeof useKnowledgeCenter>;
  inbox: KnowledgeCandidatesResult | null;
}

function emptyReason(
  state: ReturnType<typeof useKnowledgeCenter>,
  inbox: KnowledgeCandidatesResult | null,
): TranslationKey | null {
  if (state.spaces.length === 0) return 'knowledgeCenter.emptyNoSpaces';
  if ((state.index?.cardCount ?? 0) === 0 && !state.searchQuery.trim() && state.viewMode === 'cards') {
    return 'knowledgeCenter.emptyNoCards';
  }
  if (state.viewMode === 'cards' && state.hits.length === 0 && state.searchQuery.trim()) {
    return 'knowledgeCenter.emptyNoHits';
  }
  if (state.viewMode === 'candidates' && !(inbox?.candidates.length || inbox?.drafts.length)) {
    return 'knowledgeCenter.emptyNoViewData';
  }
  if (state.viewMode === 'conflicts' && !(state.pack?.conflicts.length)) {
    return 'knowledgeCenter.emptyNoViewData';
  }
  if (state.viewMode === 'cards' && state.hits.length === 0) return 'knowledgeCenter.emptyNoCards';
  return null;
}

function HitButton({
  hit: card,
  active,
  onSelect,
}: {
  hit: KnowledgeLaneHit;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <ListRow
      className={cn('knowledge-center-card-button', active && 'is-active')}
      selected={active}
      onClick={onSelect}
      data-testid={`knowledge-card-${card.cardId}`}
    >
      <span className="knowledge-center-card-title">{card.title}</span>
      <CardBadges type={card.type} lifecycle={card.lifecycle} />
    </ListRow>
  );
}

export function ListColumn({ state, inbox }: ListColumnProps) {
  const { t } = useI18n();
  const reason = emptyReason(state, inbox);
  const loading = state.loadingQuery || state.loadingOverview;

  return (
    <Panel className="knowledge-center-list" data-testid="knowledge-center-list">
      <SearchField
        className="knowledge-center-search"
        value={state.searchQuery}
        onChange={(event) => state.setSearchQuery(event.target.value)}
        onClear={() => state.setSearchQuery('')}
        placeholder={t('knowledgeCenter.searchPlaceholder')}
        data-testid="knowledge-center-search"
        aria-label={t('knowledgeCenter.searchPlaceholder')}
        clearLabel={t('knowledgeCenter.close')}
      />

      <KnowledgeFilters state={state} />
      <div className="knowledge-center-tree" data-testid="knowledge-center-tree">
        {loading && <div className="knowledge-center-empty-inline">{t('knowledgeCenter.loading')}</div>}
        {!loading && reason && (
          <div className="knowledge-center-empty" data-testid="knowledge-center-empty-list">
            <EmptyState title={t(reason)} />
          </div>
        )}
        {!loading && state.viewMode === 'cards' && !reason && state.hits.map((hit) => (
          <HitButton
            key={hit.cardId}
            hit={hit}
            active={state.selectedCardId === hit.cardId}
            onSelect={() => void state.selectCard(hit.spaceId, hit.relativePath, hit.cardId)}
          />
        ))}
        {!loading && state.viewMode === 'candidates' && inbox && (
          <>
            <div className="knowledge-center-section-title">{t('knowledgeCenter.candidatesSection')}</div>
            {inbox.candidates.map((entry) => (
              <ListRow
                key={entry.candidateId}
                className="knowledge-center-inbox-row"
                onClick={() => state.selectRecord(entry.card)}
              >
                <span className="knowledge-center-card-title">{entry.card.title}</span>
                <CardBadges type={entry.card.type} lifecycle={entry.card.lifecycle} sourceStatus={entry.card.sourceStatus} />
              </ListRow>
            ))}
            <div className="knowledge-center-section-title">{t('knowledgeCenter.draftsSection')}</div>
            {inbox.drafts.map((draft) => (
              <ListRow
                key={draft.cardId}
                className="knowledge-center-inbox-row"
                onClick={() => state.selectRecord(draft)}
              >
                <span className="knowledge-center-card-title">{draft.title}</span>
                <span className="knowledge-center-badge">{t('knowledgeCenter.draftNotCandidate')}</span>
                <CardBadges type={draft.type} lifecycle={draft.lifecycle} sourceStatus={draft.sourceStatus} />
              </ListRow>
            ))}
          </>
        )}
        {!loading && state.viewMode === 'conflicts' && state.pack && !reason && state.pack.conflicts.map((conflict) => (
          <ConflictRow key={`${conflict.leftCardId}:${conflict.rightCardId}`} leftCardId={conflict.leftCardId} rightCardId={conflict.rightCardId} />
        ))}
      </div>
    </Panel>
  );
}
