import { useState } from 'react';
import { Button } from '../../../../ui/Button';
import { Icon } from '../../../../ui/Icon';
import { InlineError } from '../../../../ui/InlineError';
import { Select } from '../../../../ui/Select';
import { Tabs } from '../../../../ui/Tabs';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { Textarea } from '../../../../ui/Textarea';
import { useI18n } from '../../../../i18n';
import { countKnowledgeImportOutcomes } from '../knowledgeImportExportModel';
import { KnowledgeTaskCancelled, KnowledgeTaskProgress } from '../parts/KnowledgeTaskProgress';
import { ImportItems, OutcomeSummary } from '../parts/KnowledgeImportItems';
import type { KnowledgeSpace } from '@shared/types/knowledge';
import type { useKnowledgeImport } from '../useKnowledgeImport';
import type { useKnowledgeCandidateInbox } from '../useKnowledgeCandidateInbox';

const fileNameOf = (filePath: string): string => filePath.split(/[\\/]/).pop() ?? filePath;

interface ImportKnowledgeDialogProps {
  importer: ReturnType<typeof useKnowledgeImport>;
  candidates: ReturnType<typeof useKnowledgeCandidateInbox>;
  spaces: KnowledgeSpace[];
}

/**
 * Choosing a source, seeing what it would do and seeing what it did are three moments of one dialog over the
 * three columns. Nothing is written until the person has seen the preview and confirmed in the main process.
 */
export function ImportKnowledgeDialog({ importer, candidates, spaces }: ImportKnowledgeDialogProps) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const step = importer.step;
  const planned = importer.preview?.items ?? [];
  const newCount = countKnowledgeImportOutcomes(planned).new;

  // Reading the source happens on the first step and reports no counts; the import itself runs from the preview step,
  // follows main's counts and can be cancelled, after which the preview stays as it was.
  const importing = importer.operation.running;
  const progress = importing ? <KnowledgeTaskProgress operation="import" progress={importer.operation.progress} />
    : importer.busy && step !== 'result' ? <KnowledgeTaskProgress label={t('knowledgeCenter.progressReading')} />
      : importer.cancelled ? <KnowledgeTaskCancelled label={t('knowledgeCenter.importCancelled')} />
        : null;
  const footer = step === 'result' ? (
    <Button variant="primary" disabled={importer.busy} onClick={importer.close}>{t('knowledgeCenter.importDone')}</Button>
  ) : step === 'preview' ? (
    <>
      {progress}
      {importing ? (
        <Button variant="secondary" loading={importer.operation.cancelling} data-testid="knowledge-center-import-cancel"
          onClick={importer.cancelImport}>
          {t('knowledgeCenter.cancelTask')}
        </Button>
      ) : (
        <Button variant="ghost" disabled={importer.busy} onClick={importer.back}>{t('knowledgeCenter.importBack')}</Button>
      )}
      <Button variant="primary" disabled={importer.busy || newCount === 0} data-testid="knowledge-center-import-run"
        onClick={() => void importer.importSource()}>
        {t('knowledgeCenter.importRunCount', { count: newCount })}
      </Button>
    </>
  ) : (
    <>
      {progress}
      <Button variant="ghost" disabled={importer.busy} onClick={importer.close}>{t('knowledgeCenter.confirmCancel')}</Button>
      {importer.mode === 'paste' ? (
        <Button variant="primary" disabled={importer.busy || !importer.source.trim()} data-testid="knowledge-center-import-preview"
          onClick={() => void importer.previewPasted()}>
          {t('knowledgeCenter.importPreview')}
        </Button>
      ) : null}
    </>
  );

  return (
    <TaskDialog
      open={importer.open}
      size="md"
      title={t(step === 'result' ? 'knowledgeCenter.importResultTitle' : 'knowledgeCenter.importTitle')}
      onClose={importer.close}
      closeLabel={t('knowledgeCenter.importClose')}
      busy={importer.busy}
      dataTestId="knowledge-center-import"
      footer={footer}
    >
      {step === 'input' ? (
        <>
          <p className="knowledge-import-lead">{t('knowledgeCenter.importDescription')}</p>
          {spaces.length > 1 ? (
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
          ) : null}
          <Tabs
            variant="segmented"
            className="knowledge-import-mode"
            label={t('knowledgeCenter.importInputMode')}
            value={importer.mode}
            onChange={(id) => importer.setMode(id as typeof importer.mode)}
            tabs={[
              { id: 'file', label: t('knowledgeCenter.importModeFile'), disabled: importer.busy },
              { id: 'paste', label: t('knowledgeCenter.importModePaste'), disabled: importer.busy },
            ]}
          />
          {importer.mode === 'file' ? (
            <div
              className={`knowledge-import-drop${dragging ? ' is-dragging' : ''}`}
              data-testid="knowledge-center-import-file"
              onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files[0];
                if (file) void importer.dropFile(file);
              }}
            >
              <Icon name="upload" size={20} className="knowledge-import-drop-icon" />
              <p className="knowledge-import-drop-title">
                {importer.filePath ? fileNameOf(importer.filePath) : t('knowledgeCenter.importDropTitle')}
              </p>
              <p className="knowledge-import-drop-hint">{t('knowledgeCenter.importFormatHint')}</p>
              <Button variant="secondary" size="sm" disabled={importer.busy} onClick={() => void importer.selectFile()}>
                {t(importer.filePath ? 'knowledgeCenter.importReplaceFile' : 'knowledgeCenter.importSelectFile')}
              </Button>
            </div>
          ) : (
            <label className="knowledge-center-field">
              <span>{t('knowledgeCenter.importContentYaml')}</span>
              <Textarea
                value={importer.source}
                spellCheck={false}
                disabled={importer.busy}
                onChange={(event) => importer.setSource(event.target.value)}
                data-testid="knowledge-center-import-source"
              />
              <span className="knowledge-import-drop-hint">{t('knowledgeCenter.importPasteHint')}</span>
            </label>
          )}
        </>
      ) : null}

      {step === 'preview' ? (
        <>
          <OutcomeSummary items={planned} written={false} />
          <ImportItems items={planned} written={false} />
          <p className="knowledge-import-lead">{t('knowledgeCenter.importPreviewHint')}</p>
        </>
      ) : null}

      {step === 'result' && importer.result ? (
        <>
          <OutcomeSummary items={importer.result.items} written />
          <ImportItems items={importer.result.items} written candidates={candidates} onProposed={importer.close} />
        </>
      ) : null}

      {importer.error ? <InlineError data-testid="knowledge-center-import-error" detail={importer.error.detail}>{importer.error.message}</InlineError> : null}
    </TaskDialog>
  );
}
