import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { MessageMarkdown } from '../../debugger/AgentChat/MessageMarkdown';
import { useI18n } from '../../../i18n';
import { useKnowledgeCenter } from './useKnowledgeCenter';
import './KnowledgeCenterModal.css';

interface KnowledgeCenterModalProps {
  open: boolean;
  onClose: () => void;
}

const BookIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15z" />
  </svg>
);

export const KnowledgeCenterModal: React.FC<KnowledgeCenterModalProps> = ({ open, onClose }) => {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const state = useKnowledgeCenter(open);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('[data-confirmation-dialog]')) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.scrollTo({ top: 0, left: 0 });
  }, [open, state.selectedCardId]);

  if (!open) return null;

  const headerTitle = state.selectedCard?.title ?? t('knowledgeCenter.title');
  const loadingTree = state.loadingSpaces || state.loadingCards;

  return createPortal(
    <div className="knowledge-center-backdrop" onClick={onClose} data-testid="knowledge-center-backdrop">
      <div
        className="knowledge-center"
        data-testid="knowledge-center-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="knowledge-center-title"
        onClick={(event) => event.stopPropagation()}
      >
        <aside className="knowledge-center-sidebar">
          <div className="knowledge-center-brand">
            <div className="knowledge-center-brand-icon">
              <BookIcon />
            </div>
            <div className="knowledge-center-brand-copy">
              <div className="knowledge-center-brand-title" id="knowledge-center-title">
                {t('knowledgeCenter.title')}
              </div>
              <div className="knowledge-center-brand-subtitle">{t('knowledgeCenter.subtitle')}</div>
            </div>
          </div>

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

          <div className="knowledge-center-tree" data-testid="knowledge-center-tree">
            {loadingTree && (
              <div className="knowledge-center-empty-inline">{t('knowledgeCenter.loading')}</div>
            )}
            {!loadingTree && state.filteredSpaces.length === 0 && (
              <div className="knowledge-center-empty-inline">{t('knowledgeCenter.noMatches')}</div>
            )}
            {!loadingTree && state.filteredSpaces.map((space) => {
              const expanded = state.expandedSpaceIds.has(space.spaceId);
              return (
                <div key={space.spaceId} className="knowledge-center-space" data-testid={`knowledge-space-${space.spaceId}`}>
                  <button
                    type="button"
                    className="knowledge-center-space-toggle"
                    onClick={() => state.toggleSpace(space.spaceId)}
                    aria-expanded={expanded}
                    data-testid={`knowledge-space-toggle-${space.spaceId}`}
                  >
                    <svg
                      className={`knowledge-center-space-chevron ${expanded ? 'is-expanded' : ''}`}
                      viewBox="0 0 12 12"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M4 2l4 4-4 4" />
                    </svg>
                    <span>{space.kind === 'user' ? t('knowledgeCenter.userSpace') : space.label}</span>
                    <span className="knowledge-center-space-kind">
                      {space.kind === 'user' ? t('knowledgeCenter.scopeUser') : t('knowledgeCenter.scopeProject')}
                    </span>
                    <span className="knowledge-center-space-meta">{space.cards.length}</span>
                  </button>
                  {expanded && (
                    <div className="knowledge-center-card-list">
                      {space.cards.length === 0 ? (
                        <div className="knowledge-center-empty-inline">{t('knowledgeCenter.emptyCards')}</div>
                      ) : (
                        space.cards.map((card) => (
                          <button
                            key={card.cardId}
                            type="button"
                            className={`knowledge-center-card-button ${state.selectedCardId === card.cardId ? 'is-active' : ''}`}
                            onClick={() => void state.selectCard(card.spaceId, card.relativePath, card.cardId)}
                            data-testid={`knowledge-card-${card.cardId}`}
                          >
                            <span className="knowledge-center-card-title">{card.title}</span>
                            {card.preview && (
                              <span className="knowledge-center-card-preview">{card.preview}</span>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {state.error && (
            <div className="knowledge-center-error" data-severity="error" data-testid="knowledge-center-error">
              {state.error}
            </div>
          )}
        </aside>

        <section className="knowledge-center-content">
          <div className="knowledge-center-header">
            <div>
              <div className="knowledge-center-header-title">{headerTitle}</div>
              {state.selectedCard && (
                <div className="knowledge-center-header-path" title={state.selectedCard.relativePath}>
                  {state.selectedCard.relativePath}
                </div>
              )}
            </div>
            <button
              type="button"
              className="knowledge-center-close"
              onClick={onClose}
              aria-label={t('knowledgeCenter.close')}
              data-testid="knowledge-center-close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="knowledge-center-body" ref={panelRef} data-testid="knowledge-center-body">
            {state.loadingDetail && (
              <div className="knowledge-center-status">{t('knowledgeCenter.loading')}</div>
            )}
            {!state.loadingDetail && !state.selectedCard && (
              <div className="knowledge-center-empty" data-testid="knowledge-center-empty-detail">
                {t('knowledgeCenter.selectPrompt')}
              </div>
            )}
            {!state.loadingDetail && state.selectedCard && (
              <article data-testid="knowledge-center-detail">
                <div className="knowledge-center-markdown">
                  <MessageMarkdown content={state.selectedCard.content} />
                </div>
              </article>
            )}
          </div>
        </section>
      </div>
    </div>,
    document.body,
  );
};

export default KnowledgeCenterModal;
