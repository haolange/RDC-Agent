import { Button } from '../../../../ui/Button';
import { InlineError } from '../../../../ui/InlineError';
import { Select } from '../../../../ui/Select';
import { Tabs } from '../../../../ui/Tabs';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { Textarea } from '../../../../ui/Textarea';
import { useI18n, type TranslationKey } from '../../../../i18n';
import type { ColdDataIngestStatus, KnowledgeSpace } from '@shared/types/knowledge';
import type { useKnowledgeImport } from '../useKnowledgeImport';

const IMPORT_STATUS_KEYS: Record<ColdDataIngestStatus, TranslationKey> = {
  draft: 'knowledgeCenter.importStatusDraft',
  quarantine: 'knowledgeCenter.importStatusQuarantine',
  conflict: 'knowledgeCenter.importStatusConflict',
};

interface ImportKnowledgeDialogProps {
  importer: ReturnType<typeof useKnowledgeImport>;
  spaces: KnowledgeSpace[];
}

/**
 * File, paste and result are states of one dialog. It layers over the three
 * columns without replacing the reading area, and never claims a draft is stored.
 */
export function ImportKnowledgeDialog({ importer, spaces }: ImportKnowledgeDialogProps) {
  const { t } = useI18n();
  const result = importer.result;
  const canImport = !importer.busy && Boolean(importer.filePath || importer.source.trim());

  const footer = result ? (
    <>
      <Button variant="ghost" disabled={importer.busy} onClick={importer.close}>
        {t('knowledgeCenter.importDone')}
      </Button>
      {result.status === 'draft' && result.record ? (
        <Button
          variant="primary"
          disabled={importer.busy}
          data-testid="knowledge-center-import-create-candidate"
          onClick={() => void importer.createCandidate(result.record!)}
        >
          {t('knowledgeCenter.importCreateCandidate')}
        </Button>
      ) : null}
    </>
  ) : (
    <>
      <Button variant="ghost" disabled={importer.busy} onClick={importer.close}>
        {t('knowledgeCenter.confirmCancel')}
      </Button>
      <Button
        variant="primary"
        disabled={!canImport}
        data-testid="knowledge-center-import-run"
        onClick={() => void importer.importSource()}
      >
        {t('knowledgeCenter.importRun')}
      </Button>
    </>
  );

  return (
    <TaskDialog
      open={importer.open}
      size="md"
      title={result ? t('knowledgeCenter.importResultTitle') : t('knowledgeCenter.importTitle')}
      description={result ? undefined : t('knowledgeCenter.importDescription')}
      onClose={importer.close}
      closeLabel={t('knowledgeCenter.importClose')}
      busy={importer.busy}
      dataTestId="knowledge-center-import"
      footer={footer}
    >
      {result ? (
        <>
          <div className="knowledge-import-result-head">
            <h3 className="knowledge-import-result-count">
              {t('knowledgeCenter.importReadCount', { count: result.record ? 1 : 0 })}
            </h3>
            <div className="knowledge-import-result-status">
              <span className="knowledge-center-badge" data-status={result.status}>
                {t(IMPORT_STATUS_KEYS[result.status])}
              </span>
              <span>{t('knowledgeCenter.importNotVerified')}</span>
            </div>
          </div>

          {result.record ? (
            <div className="knowledge-import-result-card">
              <strong>{result.record.title}</strong>
              <p>{result.record.relativePath}</p>
            </div>
          ) : null}

          {result.reason ? <InlineError>{result.reason}</InlineError> : null}

          <details className="knowledge-import-result-details" open>
            <summary>{t('knowledgeCenter.importResultDetails')}</summary>
            <dl className="knowledge-import-result-grid">
              <div>
                <dt>{t('knowledgeCenter.importCandidateCreatedFalse')}</dt>
                <dd>{String(result.candidateCreated)}</dd>
              </div>
              <div>
                <dt>{t('knowledgeCenter.importVerifiedFalse')}</dt>
                <dd>{String(result.verified)}</dd>
              </div>
            </dl>
          </details>
        </>
      ) : (
        <>
          <label className="knowledge-center-field">
            <span>{t('knowledgeCenter.importTargetSpace')}</span>
            <Select
              dataTestId="knowledge-center-import-space"
              ariaLabel={t('knowledgeCenter.importTargetSpace')}
              value={importer.spaceId}
              disabled={importer.busy}
              onChange={(value) => importer.setSpaceId(value)}
              options={spaces.map((space) => ({ value: space.spaceId, label: space.label }))}
            />
          </label>

          <Tabs
            variant="segmented"
            className="knowledge-import-mode"
            label={t('knowledgeCenter.importInputMode')}
            value={importer.mode}
            onChange={(id) => importer.setMode(id as typeof importer.mode)}
            tabs={[
              { id: 'file', label: t('knowledgeCenter.importModeFile') },
              { id: 'paste', label: t('knowledgeCenter.importModePaste') },
            ]}
          />

          {importer.mode === 'file' ? (
            <div className="knowledge-import-file" data-testid="knowledge-center-import-file">
              <span className="knowledge-import-file-name">
                {importer.filePath ?? t('knowledgeCenter.importNoFile')}
              </span>
              {importer.filePath ? (
                <span className="knowledge-center-badge">{t('knowledgeCenter.importPendingValidation')}</span>
              ) : null}
              <Button variant="secondary" size="sm" disabled={importer.busy} onClick={() => void importer.selectFile()}>
                {importer.filePath
                  ? t('knowledgeCenter.importReplaceFile')
                  : t('knowledgeCenter.importSelectFile')}
              </Button>
            </div>
          ) : (
            <label className="knowledge-center-field">
              <span>{t('knowledgeCenter.importPasteYaml')}</span>
              <Textarea
                value={importer.source}
                rows={10}
                spellCheck={false}
                disabled={importer.busy}
                onChange={(event) => importer.setSource(event.target.value)}
                data-testid="knowledge-center-import-source"
              />
            </label>
          )}

          <p className="knowledge-import-hint">{t('knowledgeCenter.importFormatHint')}</p>
          {importer.error && (
            <InlineError data-testid="knowledge-center-import-error">{importer.error}</InlineError>
          )}
        </>
      )}
    </TaskDialog>
  );
}
