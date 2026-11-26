import { useState } from 'react';
import { Button } from '../../../../ui/Button';
import { EmptyState } from '../../../../ui/EmptyState';
import { Chevron } from '../../../../ui/Chevron';
import { Panel } from '../../../../ui/Panel';
import { useI18n } from '../../../../i18n';
import { TYPE_LABEL_KEYS } from '../knowledgeCenterLabels';
import { KnowledgeCardDocument } from '../parts/KnowledgeCardDocument';
import '../parts/KnowledgeDetail.css';
import { KnowledgeStatusTag } from '../parts/KnowledgeStatusTag';
import { CardMetaGrid } from '../parts/CardMetaGrid';
import { ConflictCompare } from '../parts/ConflictCompare';
import { KnowledgeCardActionBar } from '../parts/KnowledgeCardActionBar';
import { Skeleton } from '../../../../ui/Skeleton';
import type { useKnowledgeCenter } from '../useKnowledgeCenter';
import type { useKnowledgeWriteConfirm } from '../useKnowledgeWriteConfirm';
import type { KnowledgeCardDetail, KnowledgeScopeAxis } from '@shared/types/knowledge';

interface DetailColumnProps {
  state: ReturnType<typeof useKnowledgeCenter>;
  write: ReturnType<typeof useKnowledgeWriteConfirm>;
  onCreateCandidate: () => void;
  candidateHasSession: boolean;
  candidateBusy: boolean;
  candidateError: string | null;
}

/** The scope axes that say at a glance where a card applies, in the order people name them. */
const HEADLINE_AXES: readonly KnowledgeScopeAxis[] = ['platform', 'api', 'gpuVendor', 'gpuArch', 'device', 'engine'];

function headlineFacts(card: KnowledgeCardDetail, typeLabel: string | null): string[] {
  const axes = HEADLINE_AXES.map((axis) => card.scope[axis]?.trim()).filter(
    (value): value is string => Boolean(value) && value!.toLowerCase() !== 'unknown',
  );
  return [...(typeLabel ? [typeLabel] : []), ...axes];
}

export function DetailColumn({
  state,
  write,
  onCreateCandidate,
  candidateHasSession,
  candidateBusy,
  candidateError,
}: DetailColumnProps) {
  const { t } = useI18n();
  const card = state.selectedCard;
  const conflict = state.viewMode === 'conflicts' ? state.selectedConflict : null;
  const [infoOpen, setInfoOpen] = useState(false);
  const reviewing = state.viewMode === 'candidates';
  const space = card ? state.spaces.find((entry) => entry.spaceId === card.spaceId) : undefined;
  const spaceLabel = space?.kind === 'user' ? t('knowledgeCenter.userSpace') : (space?.label ?? '');
  const facts = card ? headlineFacts(card, card.type ? t(TYPE_LABEL_KEYS[card.type]) : null) : [];

  return (
    <Panel className="knowledge-center-content" data-testid="knowledge-center-detail-column">
      {/* The modal title bar owns the product title and close; this header only identifies the selected card. */}
      {card || state.narrow ? (
        <div className="knowledge-center-header">
          <div className="knowledge-center-header-copy">
            {state.narrow && (
              <Button ref={state.backButtonRef} variant="ghost" size="sm" onClick={() => state.navigateToPane('list')}>
                {t('knowledgeCenter.back')}
              </Button>
            )}
            {card ? (
              <>
                <h1 className="knowledge-center-header-title">{card.title}</h1>
                <div className="knowledge-center-meta-line" data-testid="knowledge-center-meta-line">
                  {facts.length ? <span className="knowledge-center-facts">{facts.join(' · ')}</span> : null}
                  <KnowledgeStatusTag
                    lifecycle={card.lifecycle}
                    sourceStatus={card.sourceStatus}
                    reviewing={reviewing}
                  />
                </div>
              </>
            ) : null}
          </div>
          <div className="knowledge-center-header-actions">
            {card ? (
              <Button
                variant="ghost"
                size="sm"
                className="knowledge-detail-info-toggle"
                aria-expanded={infoOpen}
                aria-controls={infoOpen ? 'knowledge-card-information' : undefined}
                onClick={() => setInfoOpen(!infoOpen)}
                data-testid="knowledge-center-metadata-toggle"
              >
                {t('knowledgeCenter.metadata')}
                <Chevron direction="down" open={infoOpen} />
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="knowledge-center-body" data-testid="knowledge-center-body">
        {state.loadingDetail && !conflict && (
          <div role="status" aria-label={t('knowledgeCenter.loading')}>
            <Skeleton shape="line" count={8} />
          </div>
        )}
        {conflict ? (
          <ConflictCompare
            left={state.conflictCards.left}
            right={state.conflictCards.right}
            loading={state.loadingDetail}
            onOpenCard={state.openRelatedCard}
          />
        ) : null}
        {!state.loadingDetail && !card && !conflict && (
          <div className="knowledge-center-empty" data-testid="knowledge-center-empty-detail">
            <EmptyState
              variant="page"
              title={t(
                state.viewMode === 'conflicts'
                  ? 'knowledgeCenter.selectConflictPrompt'
                  : reviewing
                    ? 'knowledgeCenter.selectCandidatePrompt'
                    : 'knowledgeCenter.selectPrompt',
              )}
              description={
                state.viewMode === 'cards' && state.hits.length === 0 ? t('knowledgeCenter.emptyDetailHint') : undefined
              }
            />
          </div>
        )}
        {!state.loadingDetail && card && (
          <article data-testid="knowledge-center-detail">
            {infoOpen ? (
              <div id="knowledge-card-information" className="knowledge-detail-info">
                <CardMetaGrid
                  card={card}
                  spaceLabel={spaceLabel}
                  resolveRelation={(targetCardId) =>
                    state.hits.find((entry) => entry.cardId === targetCardId) ??
                    state.pack?.hits.find((entry) => entry.cardId === targetCardId)
                  }
                  onOpenRelation={state.openRelatedCard}
                />
              </div>
            ) : null}
            <KnowledgeCardDocument card={card} />
          </article>
        )}
      </div>

      {card ? (
        <KnowledgeCardActionBar
          card={card}
          reviewing={reviewing}
          write={write}
          onCreateCandidate={onCreateCandidate}
          candidateHasSession={candidateHasSession}
          candidateBusy={candidateBusy}
          candidateError={candidateError}
        />
      ) : null}
    </Panel>
  );
}
