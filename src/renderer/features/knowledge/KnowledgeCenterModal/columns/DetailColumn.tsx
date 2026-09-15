import { useState } from 'react';
import { KNOWLEDGE_CASE_CHAPTERS } from '@shared/types/knowledge';
import { Badge } from '../../../../ui/Badge';
import { Button } from '../../../../ui/Button';
import { EmptyState } from '../../../../ui/EmptyState';
import { Icon } from '../../../../ui/Icon';
import { Panel } from '../../../../ui/Panel';
import { useI18n } from '../../../../i18n';
import { CHAPTER_LABEL_KEYS, formatKnowledgeTime } from '../knowledgeCenterLabels';
import { detailToRecord } from '../knowledgeCenterModel';
import { CaseChapterContent } from '../parts/CaseChapterContent';
import { KnowledgeCardImages } from '../parts/KnowledgeCardImages';
import { KnowledgeMarkdown } from '../parts/KnowledgeMarkdown';
import '../parts/KnowledgeDetail.css';
import { CardBadges } from '../parts/CardBadges';
import { CardMetaGrid } from '../parts/CardMetaGrid';
import { ConflictCompare } from '../parts/ConflictCompare';
import type { useKnowledgeCenter } from '../useKnowledgeCenter';
import type { useKnowledgeWriteConfirm } from '../useKnowledgeWriteConfirm';

interface DetailColumnProps {
  state: ReturnType<typeof useKnowledgeCenter>;
  write: ReturnType<typeof useKnowledgeWriteConfirm>;
  onCreateCandidate: () => void;
}

export function DetailColumn({ state, write, onCreateCandidate }: DetailColumnProps) {
  const { t } = useI18n();
  const card = state.selectedCard;
  const conflict = state.viewMode === 'conflicts' ? state.selectedConflict : null;
  const [metadataOpen, setMetadataOpen] = useState(false);
  const missing = card?.type === 'case'
    ? KNOWLEDGE_CASE_CHAPTERS.filter((chapter) => !card.chapters?.[chapter]?.trim())
    : [];
  const isDraft = card?.lifecycle === 'draft';
  const isCandidateView = state.viewMode === 'candidates';
  const space = card ? state.spaces.find((entry) => entry.spaceId === card.spaceId) : undefined;
  const spaceLabel = space?.kind === 'user' ? t('knowledgeCenter.userSpace') : (space?.label ?? card?.spaceId ?? '');
  const updated = formatKnowledgeTime(card?.updatedAt);
  const origin = card ? [card.sourceStatus, card.caseId].filter(Boolean).join(' · ') : '';

  return (
    <Panel className="knowledge-center-content" data-testid="knowledge-center-detail-column">
      {/* The modal title bar owns the product title and close; this header only identifies the selected card. */}
      {card || state.narrow ? (
        <div className="knowledge-center-header">
          <div className="knowledge-center-header-copy">
            {state.narrow && (
              <Button variant="ghost" size="sm" onClick={() => state.setNarrowPane('list')}>
                {t('knowledgeCenter.back')}
              </Button>
            )}
            {card ? (
              <>
                <h1 className="knowledge-center-header-title">{card.title}</h1>
                <div className="knowledge-center-meta-line" data-testid="knowledge-center-meta-line">
                  {isCandidateView ? <Badge tone="warning">{t('knowledgeCenter.pendingReview')}</Badge> : null}
                  <CardBadges type={card.type} lifecycle={card.lifecycle} sourceStatus={card.sourceStatus} />
                  {updated ? <span>{t('knowledgeCenter.updatedAtPrefix')} {updated}</span> : null}
                  <span>{t('knowledgeCenter.spaceLabel')} {spaceLabel}</span>
                  {isCandidateView && origin ? <span>{t('knowledgeCenter.sourceLabel')} {origin}</span> : null}
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
                aria-expanded={metadataOpen}
                aria-controls="knowledge-card-information"
                onClick={() => setMetadataOpen(!metadataOpen)}
                data-testid="knowledge-center-metadata-toggle"
              >
                {t('knowledgeCenter.metadata')}
                <Icon name={metadataOpen ? 'chevron-up' : 'chevron-down'} size={14} />
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="knowledge-center-body" data-testid="knowledge-center-body">
        {state.loadingDetail && <div className="knowledge-center-status">{t('knowledgeCenter.loading')}</div>}
        {conflict ? (
          <ConflictCompare
            conflict={conflict}
            left={state.conflictCards.left}
            right={state.conflictCards.right}
            loading={state.loadingDetail}
            onOpenCard={state.openRelatedCard}
          />
        ) : null}
        {!state.loadingDetail && !card && !conflict && (
          <div className="knowledge-center-empty" data-testid="knowledge-center-empty-detail">
            <EmptyState
              title={t(state.viewMode === 'conflicts' ? 'knowledgeCenter.selectConflictPrompt' : isCandidateView ? 'knowledgeCenter.selectCandidatePrompt' : 'knowledgeCenter.selectPrompt')}
              description={state.viewMode === 'cards' ? t('knowledgeCenter.emptyDetailHint') : undefined}
            />
          </div>
        )}
        {!state.loadingDetail && card && (
          <article data-testid="knowledge-center-detail">
            {metadataOpen ? (
              <div id="knowledge-card-information" className="knowledge-detail-info">
                <CardMetaGrid
                  card={card}
                  spaceLabel={spaceLabel}
                  onOpenRelation={(targetCardId) => {
                    const hit = state.hits.find((entry) => entry.cardId === targetCardId)
                      ?? state.pack?.hits.find((entry) => entry.cardId === targetCardId);
                    if (hit) state.openRelatedCard(hit);
                  }}
                />
              </div>
            ) : null}
            {card.type === 'case' && (
              <nav className="knowledge-center-chapters" data-testid="knowledge-center-chapters">
                {KNOWLEDGE_CASE_CHAPTERS.filter((chapter) => card.chapters?.[chapter]?.trim()).map((chapter) => (
                  <a key={chapter} href={`#knowledge-chapter-${chapter}`}>{t(CHAPTER_LABEL_KEYS[chapter])}</a>
                ))}
                {missing.length > 0 && (
                  <p className="knowledge-center-missing">
                    {t('knowledgeCenter.chaptersMissing')}: {missing.map((chapter) => t(CHAPTER_LABEL_KEYS[chapter])).join(', ')}
                  </p>
                )}
              </nav>
            )}
            <div className="knowledge-center-markdown">
              {card.images?.length ? <KnowledgeCardImages spaceId={card.spaceId} images={card.images} /> : null}
              {card.type === 'case' && card.chapters
                ? KNOWLEDGE_CASE_CHAPTERS.filter((chapter) => card.chapters?.[chapter]?.trim()).map((chapter) => (
                  <section className="knowledge-case-section" key={chapter} id={`knowledge-chapter-${chapter}`}>
                    <h3>{t(CHAPTER_LABEL_KEYS[chapter])}</h3>
                    {card.chapters?.[chapter]
                      ? <CaseChapterContent spaceId={card.spaceId} chapter={chapter} content={card.chapters[chapter] ?? ''} />
                      : <p className="knowledge-center-missing">{t('knowledgeCenter.chaptersMissing')}</p>}
                  </section>
                ))
                : <KnowledgeMarkdown content={card.content} spaceId={card.spaceId} />}
            </div>
          </article>
        )}
      </div>

      {card && (
        <div className="knowledge-center-actions" data-testid="knowledge-center-actions">
          {isDraft ? (
            <Button variant="primary" onClick={onCreateCandidate} data-testid="knowledge-center-create-candidate">
              {t('knowledgeCenter.createCandidate')}
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => void write.openFor('promote-verified', detailToRecord(card))}>
                {t('knowledgeCenter.promoteVerified')}
              </Button>
              <Button variant="secondary" onClick={() => void write.openFor('promote-promoted', detailToRecord(card))}>
                {t('knowledgeCenter.promotePromoted')}
              </Button>
              <Button variant="danger" onClick={() => void write.openFor('deprecate', detailToRecord(card))}>
                {t('knowledgeCenter.deprecate')}
              </Button>
              <Button
                variant="primary"
                data-testid="knowledge-center-primary-write"
                onClick={() => void write.openFor(isCandidateView ? 'persist-draft' : 'save', detailToRecord(card))}
              >
                {isCandidateView ? t('knowledgeCenter.saveAsDraft') : t('knowledgeCenter.save')}
              </Button>
            </>
          )}
        </div>
      )}
    </Panel>
  );
}
