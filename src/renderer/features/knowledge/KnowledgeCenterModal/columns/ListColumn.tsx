import type { KnowledgeCandidatesResult, KnowledgeCardRecord, KnowledgeLaneHit } from '@shared/types/knowledge';
import { cn } from '../../../../lib/cn';
import { Badge } from '../../../../ui/Badge';
import { EmptyState } from '../../../../ui/EmptyState';
import { ListRow } from '../../../../ui/ListRow';
import { Panel } from '../../../../ui/Panel';
import { SearchField } from '../../../../ui/SearchField';
import { useI18n, type TranslationKey } from '../../../../i18n';
import { formatKnowledgeTime } from '../knowledgeCenterLabels';
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
  if (state.viewMode === 'candidates' && !(inbox?.candidates.length)) {
    return 'knowledgeCenter.emptyNoViewData';
  }
  if (state.viewMode === 'conflicts' && !(state.pack?.conflicts.length)) {
    return 'knowledgeCenter.emptyNoViewData';
  }
  if (state.viewMode === 'cards' && state.hits.length === 0) return 'knowledgeCenter.emptyNoCards';
  return null;
}

/** Cards row: title + badges, one-line preview, updated time. Order follows the service hits. */
function HitButton({ hit: card, active, onSelect }: { hit: KnowledgeLaneHit; active: boolean; onSelect: () => void }) {
  const updated = formatKnowledgeTime(card.updatedAt);
  return (
    <ListRow
      className={cn('knowledge-center-card-button', active && 'is-active')}
      selected={active}
      onClick={onSelect}
      data-testid={`knowledge-card-${card.cardId}`}
    >
      <span className="knowledge-center-card-head">
        <span className="knowledge-center-card-title">{card.title}</span>
        <CardBadges type={card.type} lifecycle={card.lifecycle} />
      </span>
      {card.preview && card.preview.trim() !== card.title.trim() ? <span className="knowledge-center-card-preview">{card.preview}</span> : null}
      {updated ? <span className="knowledge-center-card-time">{updated}</span> : null}
    </ListRow>
  );
}

/** Candidate row: title, origin, time, pending-review badge. */
function RecordRow({
  record,
  active,
  pendingLabel,
  onSelect,
}: {
  record: KnowledgeCardRecord;
  active: boolean;
  pendingLabel: string;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const updated = formatKnowledgeTime(record.updatedAt);
  const origin = [record.sourceStatus, record.caseId].filter(Boolean).join(' · ');
  return (
    <ListRow
      className={cn('knowledge-center-inbox-row', active && 'is-active')}
      selected={active}
      onClick={onSelect}
      data-testid={`knowledge-candidate-${record.cardId}`}
      trailing={<Badge tone="warning">{pendingLabel}</Badge>}
    >
      <span className="knowledge-center-card-head">
        <span className="knowledge-center-card-title">{record.title}</span>
        <CardBadges type={record.type} lifecycle={record.lifecycle} />
      </span>
      {origin ? <span className="knowledge-center-card-preview">{t('knowledgeCenter.sourceLabel')}: {origin}</span> : null}
      {record.preview && record.preview.trim() !== record.title.trim() ? <span className="knowledge-center-card-preview">{record.preview}</span> : null}
      {updated ? <span className="knowledge-center-card-time">{updated}</span> : null}
    </ListRow>
  );
}

export function ListColumn({ state, inbox }: ListColumnProps) {
  const { t } = useI18n();
  const reason = emptyReason(state, inbox);
  const loading = state.loadingQuery || state.loadingOverview;
  const candidateCount = inbox?.candidates.length ?? 0;
  const conflictCount = state.pack?.conflicts.length ?? 0;
  const hitById = new Map(state.pack?.hits.map((hit) => [hit.cardId, hit] as const) ?? []);

  return (
    <Panel className="knowledge-center-list" data-testid="knowledge-center-list">
      {state.viewMode === 'cards' ? (
        <>
          <SearchField
            className="knowledge-center-search"
            value={state.searchQuery}
            onChange={(event) => state.setSearchQuery(event.target.value)}
            onClear={() => state.setSearchQuery('')}
            placeholder={t('knowledgeCenter.searchPlaceholder')}
            data-testid="knowledge-center-search"
            aria-label={t('knowledgeCenter.searchPlaceholder')}
            clearLabel={t('app.clearSearch')}
          />
          <KnowledgeFilters state={state} />
        </>
      ) : (
        <div className="knowledge-center-list-head" data-testid="knowledge-center-list-head">
          <strong>
            {state.viewMode === 'candidates' ? t('knowledgeCenter.candidatesTitle') : t('knowledgeCenter.conflictsTitle')}
            <span className="knowledge-center-list-count">{state.viewMode === 'candidates' ? candidateCount : conflictCount}</span>
          </strong>
          <span className="knowledge-center-list-hint">
            {state.viewMode === 'candidates' ? t('knowledgeCenter.candidatesHint') : t('knowledgeCenter.conflictDescription')}
          </span>
        </div>
      )}
      <div className="knowledge-center-tree" data-testid="knowledge-center-tree">
        {loading && <div className="knowledge-center-empty-inline">{t('knowledgeCenter.loading')}</div>}
        {!loading && reason && (
          <div className="knowledge-center-empty" data-testid="knowledge-center-empty-list">
            <EmptyState
              title={t(reason)}
            />
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
        {!loading && state.viewMode === 'candidates' && inbox && !reason && (
          <>
            {inbox.candidates.length > 0 ? (
              <div className="knowledge-center-section-title">{t('knowledgeCenter.candidatesSection')}</div>
            ) : null}
            {inbox.candidates.map((entry) => (
              <RecordRow
                key={entry.candidateId}
                record={entry.card}
                active={state.selectedCardId === entry.card.cardId && state.selectedCard?.lifecycle === entry.card.lifecycle}
                pendingLabel={t('knowledgeCenter.pendingReview')}
                onSelect={() => state.selectRecord(entry.card)}
              />
            ))}
          </>
        )}
        {!loading && state.viewMode === 'conflicts' && state.pack && !reason && state.pack.conflicts.map((conflict) => (
          <ConflictRow
            key={`${conflict.leftCardId}:${conflict.rightCardId}`}
            leftCardId={conflict.leftCardId}
            rightCardId={conflict.rightCardId}
            left={hitById.get(conflict.leftCardId)}
            right={hitById.get(conflict.rightCardId)}
            selected={state.selectedConflict?.leftCardId === conflict.leftCardId && state.selectedConflict?.rightCardId === conflict.rightCardId}
            onSelect={() => void state.selectConflict(conflict)}
          />
        ))}
      </div>
    </Panel>
  );
}
