import type { RefObject } from 'react';
import { Button } from '../../../../ui/Button';
import { useI18n, type TranslationKey } from '../../../../i18n';
import type { ColdDataIngestStatus, KnowledgeSpace } from '@shared/types/knowledge';
import type { useKnowledgeImport } from '../useKnowledgeImport';

const IMPORT_STATUS_KEYS: Record<ColdDataIngestStatus, TranslationKey> = {
  draft: 'knowledgeCenter.importStatusDraft',
  quarantine: 'knowledgeCenter.importStatusQuarantine',
  conflict: 'knowledgeCenter.importStatusConflict',
};

interface ImportPanelProps {
  importer: ReturnType<typeof useKnowledgeImport>;
  spaces: KnowledgeSpace[];
  panelRef: RefObject<HTMLDivElement>;
}

export function ImportPanel({ importer, spaces, panelRef }: ImportPanelProps) {
  const { t } = useI18n();
  if (!importer.open) return null;
  const result = importer.result;
  return (
    <div
      ref={panelRef}
      className="knowledge-center-sheet"
      data-testid="knowledge-center-import"
      tabIndex={-1}
      aria-busy={importer.busy || undefined}
    >
      <h2>{t('knowledgeCenter.importTitle')}</h2>
      <label className="knowledge-center-field">
        <span>{t('knowledgeCenter.importTargetSpace')}</span>
        <select value={importer.spaceId} disabled={importer.busy} onChange={(event) => importer.setSpaceId(event.target.value)}>
          {spaces.map((space) => (
            <option key={space.spaceId} value={space.spaceId}>{space.label}</option>
          ))}
        </select>
      </label>
      <label className="knowledge-center-field">
        <span>{t('knowledgeCenter.importPasteYaml')}</span>
        <textarea
          value={importer.source}
          disabled={importer.busy}
          onChange={(event) => importer.setSource(event.target.value)}
          data-testid="knowledge-center-import-source"
        />
      </label>
      <div className="knowledge-center-sheet-actions">
        <Button variant="secondary" disabled={importer.busy} onClick={() => void importer.selectFile()}>
          {t('knowledgeCenter.importSelectFile')}
        </Button>
        <Button variant="primary" disabled={importer.busy || (!importer.source.trim() && !importer.filePath)} onClick={() => void importer.importSource()}>
          {t('knowledgeCenter.importColdData')}
        </Button>
        <Button variant="ghost" disabled={importer.busy} onClick={importer.close}>{t('knowledgeCenter.importClose')}</Button>
      </div>
      {importer.filePath && <p className="knowledge-center-header-path">{importer.filePath}</p>}
      {importer.error && <p className="knowledge-center-error" role="alert" data-testid="knowledge-center-import-error">{importer.error}</p>}
      {result && (
        <div className="knowledge-center-import-result" data-testid="knowledge-center-import-result">
          <p>{t(IMPORT_STATUS_KEYS[result.status])}</p>
          <p>{t('knowledgeCenter.importCandidateCreatedFalse')}: {String(result.candidateCreated)}</p>
          <p>{t('knowledgeCenter.importVerifiedFalse')}: {String(result.verified)}</p>
          {result.reason && <p>{result.reason}</p>}
          {result.status === 'draft' && result.record && (
            <Button variant="primary" disabled={importer.busy} onClick={() => void importer.createCandidate(result.record!)}>
              {t('knowledgeCenter.importCreateCandidate')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
