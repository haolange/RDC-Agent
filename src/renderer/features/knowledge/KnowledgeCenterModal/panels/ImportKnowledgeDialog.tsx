import { Button } from '../../../../ui/Button';
import { Icon } from '../../../../ui/Icon';
import { InlineError } from '../../../../ui/InlineError';
import { Select } from '../../../../ui/Select';
import { Tabs } from '../../../../ui/Tabs';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { Textarea } from '../../../../ui/Textarea';
import { useI18n, type TranslationKey } from '../../../../i18n';
import type { KnowledgeImportStatus, KnowledgeSpace } from '@shared/types/knowledge';
import type { useKnowledgeImport } from '../useKnowledgeImport';

const IMPORT_STATUS_KEYS: Record<KnowledgeImportStatus, TranslationKey> = {
  draft: 'knowledgeCenter.importStatusDraft',
  quarantine: 'knowledgeCenter.importStatusQuarantine',
  conflict: 'knowledgeCenter.importStatusConflict',
};

const IMPORT_STATUS_HINT_KEYS: Record<KnowledgeImportStatus, TranslationKey> = {
  draft: 'knowledgeCenter.importStatusDraftHint',
  quarantine: 'knowledgeCenter.importStatusQuarantineHint',
  conflict: 'knowledgeCenter.importStatusConflictHint',
};

const fileNameOf = (filePath: string): string => filePath.split(/[\\/]/).pop() ?? filePath;

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
  const canImport = importer.hasSession && !importer.busy && Boolean(importer.filePath || importer.source.trim());
  const resultItems = result?.items ?? [];
  const uniformStatus = resultItems.length > 0 && resultItems.every((item) => item.status === resultItems[0]?.status)
    ? resultItems[0].status
    : null;

  const footer = result ? (
    <>
      <Button variant="ghost" disabled={importer.busy} onClick={importer.close}>
        {t('knowledgeCenter.importDone')}
      </Button>
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
              {t('knowledgeCenter.importReadCount', { count: resultItems.length })}
            </h3>
            <div className="knowledge-import-result-status">
              {uniformStatus ? (
                <span className="knowledge-center-badge" data-status={uniformStatus}>
                  {t(IMPORT_STATUS_KEYS[uniformStatus])}
                </span>
              ) : null}
              <span>{t('knowledgeCenter.importNotVerified')}</span>
            </div>
          </div>
          {uniformStatus ? (
            <p className="knowledge-import-hint" data-testid="knowledge-center-import-status-hint">{t(IMPORT_STATUS_HINT_KEYS[uniformStatus])}</p>
          ) : null}

          {resultItems.map((item, index) => (
            <div key={item.record?.cardId ?? `${item.status}-${index}`} className="knowledge-import-result-card">
              <strong>{item.record?.title ?? item.reason ?? item.status}</strong>
              {item.record?.relativePath ? <p>{item.record.relativePath}</p> : null}
              <span className="knowledge-center-badge" data-status={item.status}>{t(IMPORT_STATUS_KEYS[item.status])}</span>
              {item.missingAssets.length > 0 ? (
                <p className="knowledge-import-hint">{t('knowledgeCenter.importMissingImages', { count: item.missingAssets.length })}</p>
              ) : null}
              {item.reason ? <InlineError>{item.reason}</InlineError> : null}
              {item.status === 'draft' && item.record ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={importer.busy || !importer.hasSession}
                  data-testid="knowledge-center-import-create-candidate"
                  onClick={() => void importer.createCandidate(item.record!)}
                >
                  {t('knowledgeCenter.importCreateCandidate')}
                </Button>
              ) : null}
            </div>
          ))}

          <details className="knowledge-import-result-details" open>
            <summary>{t('knowledgeCenter.importResultDetails')}</summary>
            <dl className="knowledge-import-result-grid">
              <div>
                <dt>{t('knowledgeCenter.importCandidateState')}</dt>
                <dd>{t('knowledgeCenter.draftNotCandidate')}</dd>
              </div>
              <div>
                <dt>{t('knowledgeCenter.importVerificationState')}</dt>
                <dd>{t('knowledgeCenter.importNotVerified')}</dd>
              </div>
            </dl>
          </details>
          {importer.error && <InlineError>{importer.error}</InlineError>}
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
              options={spaces.map((space) => ({ value: space.spaceId, label: space.kind === 'user' ? t('knowledgeCenter.userSpace') : space.label }))}
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
              <span className="knowledge-import-file-copy">
                <span className="knowledge-import-file-name">
                  {importer.filePath ? fileNameOf(importer.filePath) : t('knowledgeCenter.importNoFile')}
                  {importer.filePath ? (
                    <span className="knowledge-center-badge">{t('knowledgeCenter.importPendingValidation')}</span>
                  ) : null}
                </span>
                {importer.filePath ? <code className="knowledge-import-file-path" title={importer.filePath}>{importer.filePath}</code> : null}
              </span>
              <Button variant="secondary" size="sm" disabled={importer.busy} onClick={() => void importer.selectFile()}>
                {importer.filePath
                  ? t('knowledgeCenter.importReplaceFile')
                  : t('knowledgeCenter.importSelectFile')}
              </Button>
            </div>
          ) : (
            <label className="knowledge-center-field">
              <span>{t('knowledgeCenter.importContentYaml')}</span>
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

          {!importer.hasSession ? <InlineError>{t('knowledgeCenter.sessionRequired')}</InlineError> : null}
          <p className="knowledge-import-hint">{importer.mode === 'paste' ? t('knowledgeCenter.importPasteHint') : t('knowledgeCenter.importFormatHint')}</p>
          {(importer.filePath || importer.source.trim()) && !importer.error ? (
            <p className="knowledge-import-pending" role="status" data-testid="knowledge-center-import-pending">
              <Icon name="warning" size={14} />
              {t('knowledgeCenter.importPendingHint')}
            </p>
          ) : null}
          {importer.error && (
            <InlineError data-testid="knowledge-center-import-error">{importer.error}</InlineError>
          )}
        </>
      )}
    </TaskDialog>
  );
}
