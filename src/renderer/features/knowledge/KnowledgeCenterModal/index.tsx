import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../../ui/Button';
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
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (write.open) {
        write.close();
        return;
      }
      if (importer.open) {
        importer.close();
        return;
      }
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [importer, onClose, open, write]);

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
        className={`knowledge-center ${state.narrow ? 'is-narrow' : ''}`}
        data-testid="knowledge-center-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="knowledge-center-title"
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
          {importer.open && <ImportPanel importer={importer} spaces={state.spaces} />}
          {write.open && <WriteConfirmPanel write={write} />}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default KnowledgeCenterModal;
