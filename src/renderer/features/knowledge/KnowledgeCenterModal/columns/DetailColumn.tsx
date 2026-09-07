import { useState } from 'react';
import { KNOWLEDGE_CASE_CHAPTERS } from '@shared/types/knowledge';
import { MessageMarkdown } from '../../../../patterns/Markdown/MessageMarkdown';
import { Button } from '../../../../ui/Button';
import { ResourceEmptyState } from '../../../../ui/ResourceEmptyState';
import { useI18n } from '../../../../i18n';
import { CHAPTER_LABEL_KEYS } from '../knowledgeCenterLabels';
import { detailToRecord } from '../knowledgeCenterModel';
import { CaseChapterContent } from '../parts/CaseChapterContent';
import '../parts/KnowledgeDetail.css';
import { CardMetaGrid } from '../parts/CardMetaGrid';
import type { useKnowledgeCenter } from '../useKnowledgeCenter';
import type { useKnowledgeWriteConfirm } from '../useKnowledgeWriteConfirm';

interface DetailColumnProps {
  state: ReturnType<typeof useKnowledgeCenter>;
  write: ReturnType<typeof useKnowledgeWriteConfirm>;
  onClose: () => void;
  onCreateCandidate: () => void;
}

export function DetailColumn({ state, write, onClose, onCreateCandidate }: DetailColumnProps) {
  const { t } = useI18n();
  const card = state.selectedCard;
  const [metadataOpen, setMetadataOpen] = useState(false);
  const headerTitle = card?.title ?? t('knowledgeCenter.title');
  const missing = card?.type === 'case'
    ? KNOWLEDGE_CASE_CHAPTERS.filter((chapter) => !card.chapters?.[chapter]?.trim())
    : [];
  const isDraft = card?.lifecycle === 'draft';
  const isCandidateView = state.viewMode === 'candidates';

  return (
    <section className="knowledge-center-content" data-testid="knowledge-center-detail-column">
      <div className="knowledge-center-header">
        <div>
          {state.narrow && (
            <Button variant="ghost" size="sm" onClick={() => state.setNarrowPane('list')}>
              {t('knowledgeCenter.back')}
            </Button>
          )}
          <div className="knowledge-center-header-title">{headerTitle}</div>
          {card && (
            <div className="knowledge-center-header-path" title={card.relativePath}>{card.relativePath}</div>
          )}
        </div>
        <Button
          variant="ghost"
          className="knowledge-center-close"
          onClick={onClose}
          aria-label={t('knowledgeCenter.close')}
          data-testid="knowledge-center-close"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </Button>
      </div>

      <div className="knowledge-center-body" data-testid="knowledge-center-body">
        {state.loadingDetail && <div className="knowledge-center-status">{t('knowledgeCenter.loading')}</div>}
        {!state.loadingDetail && !card && (
          <div className="knowledge-center-empty" data-testid="knowledge-center-empty-detail">
            <ResourceEmptyState>{t('knowledgeCenter.selectPrompt')}</ResourceEmptyState>
          </div>
        )}
        {!state.loadingDetail && card && (
          <article data-testid="knowledge-center-detail">
            <div className="knowledge-detail-info">
              <Button variant="ghost" className="knowledge-detail-info-toggle" aria-expanded={metadataOpen}
                aria-controls="knowledge-card-information" onClick={() => setMetadataOpen(!metadataOpen)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h4"/></svg>
                {t('knowledgeCenter.metadata')}
                <svg className="knowledge-detail-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
              </Button>
              {metadataOpen && <div id="knowledge-card-information"><CardMetaGrid card={card} /></div>}
            </div>
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
              {card.type === 'case' && card.chapters
                ? KNOWLEDGE_CASE_CHAPTERS.filter((chapter) => card.chapters?.[chapter]?.trim()).map((chapter) => (
                  <section className="knowledge-case-section" key={chapter} id={`knowledge-chapter-${chapter}`}>
                    <h3>{t(CHAPTER_LABEL_KEYS[chapter])}</h3>
                    {card.chapters?.[chapter]
                      ? <CaseChapterContent chapter={chapter} content={card.chapters[chapter] ?? ''} />
                      : <p className="knowledge-center-missing">{t('knowledgeCenter.chaptersMissing')}</p>}
                  </section>
                ))
                : <MessageMarkdown content={card.content} />}
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
                onClick={() => void write.openFor(isCandidateView ? 'persist-draft' : 'save', detailToRecord(card))}
              >
                {isCandidateView ? t('knowledgeCenter.persistDraft') : t('knowledgeCenter.save')}
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
