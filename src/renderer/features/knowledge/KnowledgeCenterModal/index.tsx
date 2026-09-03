import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../../ui/Button';
import { useModalFocus } from '../../../hooks/useModalFocus';
import { useI18n } from '../../../i18n';
import { SpacesColumn } from './columns/SpacesColumn';
import { ListColumn } from './columns/ListColumn';
import { DetailColumn } from './columns/DetailColumn';
import { ImportPanel } from './panels/ImportPanel';
import { WriteConfirmPanel } from './panels/WriteConfirmPanel';
import { useKnowledgeCenter } from './useKnowledgeCenter';
import { useKnowledgeImport } from './useKnowledgeImport';
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
  const importRef = useRef<HTMLDivElement>(null);
  const writeRef = useRef<HTMLDivElement>(null);
  const writeOpen = write.open;
  const closeWrite = write.close;
  const importOpen = importer.open;
  const closeImport = importer.close;
  const closeSurface = useCallback(() => {
    if (writeOpen) {
      closeWrite();
      return;
    }
    if (importOpen) {
      closeImport();
      return;
    }
    onClose();
  }, [closeImport, closeWrite, importOpen, onClose, writeOpen]);
  const busy = state.loadingOverview || state.loadingQuery || importer.busy || write.busy;
  useModalFocus({
    open,
    containerRef: dialogRef,
    onClose: closeSurface,
    busy,
    trapRootRef: write.open ? writeRef : importer.open ? importRef : undefined,
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
    <div className="knowledge-center-backdrop" onClick={onClose} data-testid="knowledge-center-backdrop">
      <div
        ref={dialogRef}
        className={`knowledge-center ${state.narrow ? 'is-narrow' : ''}`}
        data-testid="knowledge-center-modal"
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby="knowledge-center-title"
        aria-busy={busy || undefined}
        onClick={(event) => event.stopPropagation()}
      >
        {state.narrow && (
          <div className="knowledge-center-narrow-tabs" data-testid="knowledge-center-narrow-tabs">
            {(['spaces', 'list', 'detail'] as const).map((pane) => (
              <Button
                key={pane}
                variant={state.narrowPane === pane ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => state.setNarrowPane(pane)}
              >
                {t(pane === 'spaces' ? 'knowledgeCenter.paneSpaces' : pane === 'list' ? 'knowledgeCenter.paneList' : 'knowledgeCenter.paneDetail')}
              </Button>
            ))}
          </div>
        )}
        <div className="knowledge-center-grid" ref={bodyRef}>
          {showSpaces && <SpacesColumn state={state} onImport={importer.openPanel} />}
          {showList && <ListColumn state={state} inbox={importer.inbox} />}
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
          {importer.open && <ImportPanel importer={importer} spaces={state.spaces} panelRef={importRef} />}
          {write.open && <WriteConfirmPanel write={write} panelRef={writeRef} />}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default KnowledgeCenterModal;
