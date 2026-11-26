import { cn } from '../../../../lib/cn';
import { Button } from '../../../../ui/Button';
import { Icon } from '../../../../ui/Icon';
import { EmptyState } from '../../../../ui/EmptyState';
import { InlineError } from '../../../../ui/InlineError';
import { ListRow } from '../../../../ui/ListRow';
import { Panel } from '../../../../ui/Panel';
import { SearchField } from '../../../../ui/SearchField';
import { useI18n, type TranslationKey } from '../../../../i18n';
import { KnowledgeFilters } from '../parts/KnowledgeFilters';
import { KnowledgeStatusTag } from '../parts/KnowledgeStatusTag';
import { TYPE_ICONS, TYPE_LABEL_KEYS } from '../knowledgeCenterLabels';
import { ConflictRow } from '../parts/ConflictRow';
import { Skeleton } from '../../../../ui/Skeleton';
import type {
  KnowledgeCandidatesResult,
  KnowledgeCardRecord,
  KnowledgeCardType,
  KnowledgeLaneHit,
} from '@shared/types/knowledge';
import type { useKnowledgeCenter } from '../useKnowledgeCenter';

interface ListColumnProps {
  state: ReturnType<typeof useKnowledgeCenter>;
  inbox: KnowledgeCandidatesResult | null;
  /** Why the review queue could not be read, when it could not. */
  inboxError?: string | null;
  /** Opens the import dialog; an empty card list offers it where the cards would be. */
  onImport: () => void;
  /** Opens the rebuild dialog; the list offers it only when the index could not be built. */
  onRebuildIndex: () => void;
}

/** The card type as a small icon before the title; its name is the tooltip. */
function TypeIcon({ type }: { type?: KnowledgeCardType }) {
  const { t } = useI18n();
  if (!type) return null;
  return (
    <span
      className="knowledge-center-card-type"
      data-tooltip={t(TYPE_LABEL_KEYS[type])}
      aria-label={t(TYPE_LABEL_KEYS[type])}
      role="img"
    >
      <Icon name={TYPE_ICONS[type]} size={14} />
    </span>
  );
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
  if (state.viewMode === 'candidates' && !inbox?.candidates.length) {
    return 'knowledgeCenter.emptyNoViewData';
  }
  if (state.viewMode === 'conflicts' && !state.pack?.conflicts.length) {
    return 'knowledgeCenter.emptyNoViewData';
  }
  if (state.viewMode === 'cards' && state.hits.length === 0) return 'knowledgeCenter.emptyNoCards';
  return null;
}

/** Up to two lines of title led by the type icon, one line of preview, and a status only when it is not a draft. */
function HitButton({ hit: card, active, onSelect }: { hit: KnowledgeLaneHit; active: boolean; onSelect: () => void }) {
  return (
    <ListRow
      className={cn('knowledge-center-card-button', active && 'is-active')}
      selected={active}
      onClick={onSelect}
      data-testid={`knowledge-card-${card.cardId}`}
    >
      <span className="knowledge-center-card-title">
        <TypeIcon type={card.type} />
        {card.title}
      </span>
      {card.preview && card.preview.trim() !== card.title.trim() ? (
        <span className="knowledge-center-card-preview">{card.preview}</span>
      ) : null}
      <KnowledgeStatusTag lifecycle={card.lifecycle} hideDraft />
    </ListRow>
  );
}

/** The queue header owns the review status shared by every candidate. */
function RecordRow({
  record,
  active,
  onSelect,
}: {
  record: KnowledgeCardRecord;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <ListRow
      className={cn('knowledge-center-inbox-row', active && 'is-active')}
      selected={active}
      onClick={onSelect}
      data-testid={`knowledge-candidate-${record.cardId}`}
    >
      <span className="knowledge-center-card-title">
        <TypeIcon type={record.type} />
        {record.title}
      </span>
      {record.preview && record.preview.trim() !== record.title.trim() ? (
        <span className="knowledge-center-card-preview">{record.preview}</span>
      ) : null}
    </ListRow>
  );
}

export function ListColumn({ state, inbox, inboxError, onImport, onRebuildIndex }: ListColumnProps) {
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
          {/* The index keeps itself current; only when it could not be built does the list ask for a rebuild, which
              opens the rebuild dialog so its progress, Cancel and any failure have one place. */}
          {state.spaces.length > 0 && !state.index && !state.loadingOverview ? (
            <div className="knowledge-center-index-notice" role="status" data-testid="knowledge-center-index-notice">
              <span>{t('knowledgeCenter.indexMissing')}</span>
              <Button
                variant="secondary"
                size="sm"
                aria-haspopup="dialog"
                onClick={onRebuildIndex}
                data-testid="knowledge-center-rebuild"
              >
                {t('knowledgeCenter.indexRebuild')}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="knowledge-center-list-head" data-testid="knowledge-center-list-head">
          <strong>
            {state.viewMode === 'candidates'
              ? t('knowledgeCenter.candidatesTitle')
              : t('knowledgeCenter.conflictsTitle')}
            <span className="knowledge-center-list-count">
              {state.viewMode === 'candidates' ? candidateCount : conflictCount}
            </span>
          </strong>
          <span className="knowledge-center-list-hint">
            {state.viewMode === 'candidates'
              ? t('knowledgeCenter.candidatesHint')
              : t('knowledgeCenter.conflictDescription')}
          </span>
        </div>
      )}
      <div
        className="knowledge-center-tree"
        data-testid="knowledge-center-tree"
        ref={state.listFocusRef}
        tabIndex={state.narrow ? -1 : undefined}
      >
        {loading && (
          <div role="status" aria-label={t('knowledgeCenter.loading')}>
            <Skeleton shape="row" count={5} />
          </div>
        )}
        {!loading && state.viewMode === 'candidates' && inboxError ? (
          <InlineError detail={inboxError}>{t('app.error.loadFailed')}</InlineError>
        ) : null}
        {!loading && reason && (
          <div className="knowledge-center-empty" data-testid="knowledge-center-empty-list">
            <EmptyState
              title={t(reason)}
              actions={
                reason === 'knowledgeCenter.emptyNoCards' ? (
                  <Button variant="primary" size="sm" onClick={onImport} data-testid="knowledge-center-empty-import">
                    {t('knowledgeCenter.importKnowledge')}
                  </Button>
                ) : undefined
              }
            />
          </div>
        )}
        {!loading &&
          state.viewMode === 'cards' &&
          !reason &&
          state.hits.map((hit) => (
            <HitButton
              key={hit.cardId}
              hit={hit}
              active={state.selectedCardId === hit.cardId}
              onSelect={() => void state.selectCard(hit.spaceId, hit.relativePath, hit.cardId, hit.contentHash)}
            />
          ))}
        {!loading && state.viewMode === 'cards' && state.page.nextOffset !== undefined ? (
          <Button variant="ghost" size="sm" onClick={() => void state.loadMore()} disabled={state.loadingMore}>
            {state.loadingMore ? t('knowledgeCenter.loading') : t('knowledgeCenter.loadMore')}
          </Button>
        ) : null}
        {!loading &&
          state.viewMode === 'candidates' &&
          !reason &&
          inbox?.candidates.map((entry) => (
            <RecordRow
              key={entry.candidateId}
              record={entry.card}
              active={
                state.selectedCardId === entry.card.cardId && state.selectedCard?.lifecycle === entry.card.lifecycle
              }
              onSelect={() => state.selectRecord(entry.card)}
            />
          ))}
        {!loading &&
          state.viewMode === 'conflicts' &&
          state.pack &&
          !reason &&
          state.pack.conflicts.map((conflict) => (
            <ConflictRow
              key={`${conflict.leftCardId}:${conflict.rightCardId}`}
              left={hitById.get(conflict.leftCardId)}
              right={hitById.get(conflict.rightCardId)}
              selected={
                state.selectedConflict?.leftCardId === conflict.leftCardId &&
                state.selectedConflict.rightCardId === conflict.rightCardId
              }
              onSelect={() => void state.selectConflict(conflict)}
            />
          ))}
      </div>
    </Panel>
  );
}
