import type { KnowledgeCandidatesResult, KnowledgeLaneHit } from '@shared/types/knowledge';
import { cn } from '../../../../lib/cn';
import { Button } from '../../../../ui/Button';
import { ResourceEmptyState } from '../../../../ui/ResourceEmptyState';
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
    <Button
      variant="ghost"
      className={cn('knowledge-center-card-button', active && 'is-active')}
      onClick={onSelect}
      data-testid={`knowledge-card-${card.cardId}`}
    >
      <span className="knowledge-center-card-title">{card.title}</span>
      <CardBadges type={card.type} lifecycle={card.lifecycle} />
    </Button>
  );
}

export function ListColumn({ state, inbox }: ListColumnProps) {
  const { t } = useI18n();
  const reason = emptyReason(state, inbox);
  const loading = state.loadingQuery || state.loadingOverview;

  return (
    <section className="knowledge-center-list" data-testid="knowledge-center-list">
      <label className="knowledge-center-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="search"
          value={state.searchQuery}
          onChange={(event) => state.setSearchQuery(event.target.value)}
          placeholder={t('knowledgeCenter.searchPlaceholder')}
          data-testid="knowledge-center-search"
          aria-label={t('knowledgeCenter.searchPlaceholder')}
        />
      </label>

      <KnowledgeFilters state={state} />
      <div className="knowledge-center-tree" data-testid="knowledge-center-tree">
        {loading && <div className="knowledge-center-empty-inline">{t('knowledgeCenter.loading')}</div>}
        {!loading && reason && (
          <div className="knowledge-center-empty" data-testid="knowledge-center-empty-list"><ResourceEmptyState>{t(reason)}</ResourceEmptyState></div>
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
              <Button
                key={entry.candidateId}
                variant="ghost"
                className="knowledge-center-inbox-row"
                onClick={() => state.selectRecord(entry.card)}
              >
                <span className="knowledge-center-card-title">{entry.card.title}</span>
                <CardBadges type={entry.card.type} lifecycle={entry.card.lifecycle} sourceStatus={entry.card.sourceStatus} />
              </Button>
            ))}
            <div className="knowledge-center-section-title">{t('knowledgeCenter.draftsSection')}</div>
            {inbox.drafts.map((draft) => (
              <Button
                key={draft.cardId}
                variant="ghost"
                className="knowledge-center-inbox-row"
                onClick={() => state.selectRecord(draft)}
              >
                <span className="knowledge-center-card-title">{draft.title}</span>
                <span className="knowledge-center-badge">{t('knowledgeCenter.draftNotCandidate')}</span>
                <CardBadges type={draft.type} lifecycle={draft.lifecycle} sourceStatus={draft.sourceStatus} />
              </Button>
            ))}
          </>
        )}
        {!loading && state.viewMode === 'conflicts' && state.pack && !reason && state.pack.conflicts.map((conflict) => (
          <ConflictRow key={`${conflict.leftCardId}:${conflict.rightCardId}`} leftCardId={conflict.leftCardId} rightCardId={conflict.rightCardId} />
        ))}
      </div>
    </section>
  );
}
