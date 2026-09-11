import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '../../../lib/useModalFocus';
import { useOverlayLayer } from '../../../lib/overlayStack';
import { useI18n } from '../../../i18n';
import { Icon } from '../../../ui/Icon';
import { IconButton } from '../../../ui/IconButton';
import { Tabs } from '../../../ui/Tabs';
import { Button } from '../../../ui/Button';
import { SpacesColumn } from './columns/SpacesColumn';
import { ListColumn } from './columns/ListColumn';
import { DetailColumn } from './columns/DetailColumn';
import { ImportKnowledgeDialog } from './panels/ImportKnowledgeDialog';
import { ExportKnowledgeDialog } from './panels/ExportKnowledgeDialog';
import { WriteConfirmDialog } from './panels/WriteConfirmDialog';
import { useKnowledgeCenter } from './useKnowledgeCenter';
import { useKnowledgeImport } from './useKnowledgeImport';
import { useKnowledgeExport } from './useKnowledgeExport';
import { useKnowledgeWriteConfirm } from './useKnowledgeWriteConfirm';
import { detailToRecord } from './knowledgeCenterModel';
import './KnowledgeCenterModal.css';

interface KnowledgeCenterModalProps {
  open: boolean;
  onClose: () => void;
}

export const KnowledgeCenterModal: React.FC<KnowledgeCenterModalProps> = ({ open, onClose }) => {
  const { t } = useI18n();
  const state = useKnowledgeCenter(open);
  const importer = useKnowledgeImport({
    open,
    sessionId: state.sessionId,
    spaces: state.spaces,
    onCreated: async () => {
      await state.refreshOverview();
      await state.refreshQuery();
    },
  });
  const exporter = useKnowledgeExport({
    spaces: state.spaces,
    hits: state.hits,
    selected: state.selectedCard
      ? { spaceId: state.selectedCard.spaceId, relativePath: state.selectedCard.relativePath }
      : null,
  });
  const write = useKnowledgeWriteConfirm({
    pack: state.pack,
    packQueryKey: state.packQueryKey,
    queryRequest: state.queryRequest,
    onWritten: async () => {
      await state.refreshOverview();
      await state.refreshQuery();
      await importer.refreshInbox();
    },
  });
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const busy = state.loadingOverview || state.loadingQuery || importer.busy || write.busy || exporter.busy;
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

  if (!open) return null;

  const showSpaces = !state.narrow || state.narrowPane === 'spaces';
  const showList = !state.narrow || state.narrowPane === 'list';
  const showDetail = !state.narrow || state.narrowPane === 'detail';

  return createPortal(
    // The task dialogs are siblings of the backdrop, not children: React portals
    // bubble through the React tree, so nesting them would route every click
    // inside a dialog into the backdrop's close handler.
    <>
      <div className="knowledge-center-backdrop" onClick={onClose} data-testid="knowledge-center-backdrop">
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
              {!state.narrow ? (
                <IconButton label={t('knowledgeCenter.close')} size="sm" onClick={onClose}>
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
                onClick={onClose}
              >
                <Icon name="close" size={16} />
              </IconButton>
            </div>
          )}
          <div className="knowledge-center-grid" ref={bodyRef}>
            {showSpaces && <SpacesColumn state={state} />}
            {showList && <ListColumn state={state} inbox={importer.inbox} onImport={importer.openPanel} />}
            {showDetail && (
              <DetailColumn
                state={state}
                write={write}
                onClose={onClose}
                onCreateCandidate={() => {
                  if (state.selectedCard) void importer.createCandidate(detailToRecord(state.selectedCard));
                }}
              />
            )}
            </div>
          </div>
        </div>

      <ImportKnowledgeDialog importer={importer} spaces={state.spaces} />
      <ExportKnowledgeDialog exporter={exporter} spaces={state.spaces} />
      <WriteConfirmDialog write={write} />
    </>,
    document.body,
  );
};

export default KnowledgeCenterModal;
