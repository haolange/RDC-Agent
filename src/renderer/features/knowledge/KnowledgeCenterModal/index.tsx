import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '../../../lib/useModalFocus';
import { useOverlayLayer } from '../../../lib/overlayStack';
import { useI18n } from '../../../i18n';
import { Icon } from '../../../ui/Icon';
import { IconButton } from '../../../ui/IconButton';
import { Menu } from '../../../ui/Menu';
import { Tabs } from '../../../ui/Tabs';
import { Button } from '../../../ui/Button';
import { usePresence } from '../../../ui/usePresence';
import { SpacesColumn } from './columns/SpacesColumn';
import { ListColumn } from './columns/ListColumn';
import { DetailColumn } from './columns/DetailColumn';
import { ImportKnowledgeDialog } from './panels/ImportKnowledgeDialog';
import { ExportKnowledgeDialog } from './panels/ExportKnowledgeDialog';
import { WriteConfirmDialog } from './panels/WriteConfirmDialog';
import { KnowledgeTopicsDialog } from './panels/KnowledgeTopicsDialog';
import { RebuildIndexDialog } from './panels/RebuildIndexDialog';
import { useKnowledgeCenter } from './useKnowledgeCenter';
import { useKnowledgeImport } from './useKnowledgeImport';
import { useKnowledgeCandidateInbox } from './useKnowledgeCandidateInbox';
import { useKnowledgeExport } from './useKnowledgeExport';
import { useKnowledgeWriteConfirm } from './useKnowledgeWriteConfirm';
import { useKnowledgeTopics } from './useKnowledgeTopics';
import { detailToRecord } from './knowledgeCenterModel';
import { firstImportedSpaceCard } from './knowledgeImportExportModel';
import './KnowledgeCenterModal.css';

interface KnowledgeCenterModalProps {
  open: boolean;
  onClose: () => void;
}

export const KnowledgeCenterModal: React.FC<KnowledgeCenterModalProps> = ({ open, onClose }) => {
  const { t } = useI18n();
  const state = useKnowledgeCenter(open);
  const candidates = useKnowledgeCandidateInbox({ open, sessionId: state.sessionId });
  const importer = useKnowledgeImport({
    open,
    sessionId: state.sessionId,
    spaces: state.spaces,
    onImported: async (imported) => {
      await candidates.refreshInbox();
      const first = firstImportedSpaceCard(imported);
      if (first) {
        await state.revealImportedCard(first);
        return;
      }
      await state.refreshOverview();
      await state.refreshQuery();
    },
  });
  const exporter = useKnowledgeExport({
    active: open,
    spaces: state.spaces,
    hits: state.hits,
    queryRequest: state.queryRequest,
    queryRevision: state.page.revision,
    filteredCount: state.page.total,
    selected: state.viewMode === 'cards' && state.selectedCard
      ? { spaceId: state.selectedCard.spaceId, relativePath: state.selectedCard.relativePath }
      : null,
  });
  const write = useKnowledgeWriteConfirm({
    active: open,
    pack: state.pack,
    packQueryKey: state.packQueryKey,
    queryRequest: state.queryRequest,
    onWritten: async () => {
      await state.refreshOverview();
      await state.refreshQuery();
      await candidates.refreshInbox();
    },
  });
  const topics = useKnowledgeTopics(open, async () => {
    await state.refreshOverview();
    await state.refreshQuery();
    if (state.viewMode === 'cards' && state.selectedCard) {
      await state.selectCard(state.selectedCard.spaceId, state.selectedCard.relativePath, state.selectedCard.cardId);
    }
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const [rebuildOpen, setRebuildOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const presence = usePresence(open, backdropRef);
  const busy = state.loadingOverview || state.loadingQuery || importer.busy || candidates.busy || write.busy || exporter.busy || topics.busy;
  // Sub-dialogs register their own overlay layers, so Escape here only ever
  // closes the Knowledge Center itself.
  const { layerId } = useOverlayLayer(open);
  useModalFocus({
    open,
    containerRef: dialogRef,
    onClose,
    busy,
    layerId,
  });

  useEffect(() => {
    if (!open) return;
    bodyRef.current?.scrollTo({ top: 0, left: 0 });
  }, [open, state.selectedCardId]);

  if (!presence.mounted) return null;

  const showSpaces = !state.narrow || state.narrowPane === 'spaces';
  const showList = !state.narrow || state.narrowPane === 'list';
  const showDetail = !state.narrow || state.narrowPane === 'detail';

  return createPortal(
    // The task dialogs are siblings of the backdrop, not children: React portals
    // bubble through the React tree, so nesting them would route every click
    // inside a dialog into the backdrop's close handler.
    <>
      <div ref={backdropRef} className="knowledge-center-backdrop" data-state={presence.state} onClick={onClose} data-testid="knowledge-center-backdrop">
        <div
          ref={dialogRef}
          className={`knowledge-center ${state.narrow ? 'is-narrow' : ''}`}
          data-testid="knowledge-center-modal"
          role="dialog"
          tabIndex={-1}
          aria-modal="true"
          aria-label={t('knowledgeCenter.title')}
          aria-busy={busy || undefined}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="knowledge-center-topbar">
            <div className="knowledge-center-brand">
              <Icon name="book" size={16} />
              <h2 className="knowledge-center-brand-title" id="knowledge-center-title">
                {t('knowledgeCenter.title')}
              </h2>
            </div>
            <div className="knowledge-center-topbar-actions">
              {/* Moving knowledge in and out are the two things people come here to do; organizing is occasional. */}
              <Button
                variant="primary"
                size="sm"
                onClick={importer.openPanel}
                data-testid="knowledge-center-import-open"
              >
                {t('knowledgeCenter.importKnowledge')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!exporter.canExport}
                onClick={exporter.openPanel}
                data-testid="knowledge-center-export-open"
              >
                {t('knowledgeCenter.exportKnowledge')}
              </Button>
              <Menu
                open={moreOpen}
                onOpenChange={setMoreOpen}
                align="end"
                label={t('knowledgeCenter.moreActions')}
                items={[
                  { id: 'topics', label: t('knowledgeCenter.topicsTitle'), onSelect: () => void topics.openPanel() },
                  { id: 'rebuild', label: t('knowledgeCenter.indexRebuild'), onSelect: () => setRebuildOpen(true) },
                ]}
                trigger={(
                  <IconButton label={t('knowledgeCenter.moreActions')} size="sm" aria-haspopup="menu" data-testid="knowledge-center-more">
                    <Icon name="more" size={16} />
                  </IconButton>
                )}
              />
              {!state.narrow ? (
                <IconButton label={t('knowledgeCenter.close')} size="sm" onClick={onClose} data-testid="knowledge-center-close">
                  <Icon name="close" size={16} />
                </IconButton>
              ) : null}
            </div>
          </div>

          {state.narrow && (
            <div className="knowledge-center-narrow-tabs" data-testid="knowledge-center-narrow-tabs">
              <Tabs
                className="knowledge-center-narrow-switch"
                label={t('knowledgeCenter.viewLabel')}
                value={state.narrowPane}
                onChange={(id) => state.setNarrowPane(id as typeof state.narrowPane)}
                tabs={[
                  { id: 'spaces', label: t('knowledgeCenter.paneSpaces') },
                  { id: 'list', label: t('knowledgeCenter.paneList') },
                  { id: 'detail', label: t('knowledgeCenter.paneDetail') },
                ]}
              />
              <IconButton
                label={t('knowledgeCenter.close')}
                className="knowledge-center-narrow-close"
                data-testid="knowledge-center-close"
                onClick={onClose}
              >
                <Icon name="close" size={16} />
              </IconButton>
            </div>
          )}
          <div className="knowledge-center-grid" ref={bodyRef}>
            {showSpaces && <SpacesColumn state={state} candidateCount={candidates.inbox?.candidates.length} />}
            {showList && <ListColumn state={state} inbox={candidates.inbox} inboxError={candidates.error} onImport={importer.openPanel} />}
            {showDetail && (
              <DetailColumn
                state={state}
                write={write}
                candidateHasSession={candidates.hasSession}
                candidateBusy={candidates.busy}
                candidateError={candidates.candidateError?.cardId === state.selectedCard?.cardId
                  ? candidates.candidateError?.message ?? null : null}
                onCreateCandidate={() => {
                  if (state.selectedCard) void candidates.createCandidate(detailToRecord(state.selectedCard));
                }}
              />
            )}
            </div>
          </div>
        </div>

      <ImportKnowledgeDialog importer={importer} candidates={candidates} spaces={state.spaces} />
      <ExportKnowledgeDialog exporter={exporter} spaces={state.spaces} />
      <WriteConfirmDialog write={write} spaces={state.spaces} />
      <KnowledgeTopicsDialog topics={topics} />
      <RebuildIndexDialog open={rebuildOpen} index={state.index} rebuilding={state.rebuilding}
        onRebuild={state.rebuildIndex} onClose={() => setRebuildOpen(false)} />
    </>,
    document.body,
  );
};

export default KnowledgeCenterModal;
