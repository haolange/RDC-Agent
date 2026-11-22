import { useState } from 'react';
import { Badge, type BadgeTone } from '../../../../ui/Badge';
import { Button } from '../../../../ui/Button';
import { Icon } from '../../../../ui/Icon';
import { InlineError } from '../../../../ui/InlineError';
import { Select } from '../../../../ui/Select';
import { Tabs } from '../../../../ui/Tabs';
import { TaskDialog } from '../../../../ui/TaskDialog';
import { Textarea } from '../../../../ui/Textarea';
import { useI18n, type TranslationKey } from '../../../../i18n';
import { TYPE_ICONS, TYPE_LABEL_KEYS } from '../knowledgeCenterLabels';
import {
  countKnowledgeImportOutcomes,
  knowledgeImportOutcome,
  knowledgeQuarantineReason,
  type KnowledgeImportOutcome,
} from '../knowledgeImportExportModel';
import type { KnowledgeImportItem, KnowledgeSpace } from '@shared/types/knowledge';
import type { useKnowledgeImport } from '../useKnowledgeImport';
import type { useKnowledgeCandidateInbox } from '../useKnowledgeCandidateInbox';

const OUTCOME_TONE: Record<KnowledgeImportOutcome, BadgeTone> = { new: 'success', present: 'neutral', conflict: 'warning', quarantine: 'error' };

const OUTCOME_LABEL_KEYS: Record<KnowledgeImportOutcome, TranslationKey> = {
  new: 'knowledgeCenter.importOutcome.new',
  present: 'knowledgeCenter.importOutcome.present',
  conflict: 'knowledgeCenter.importOutcome.conflict',
  quarantine: 'knowledgeCenter.importOutcome.quarantine',
};

const WRITTEN_LABEL_KEYS: Record<KnowledgeImportOutcome, TranslationKey> = {
  new: 'knowledgeCenter.importWritten.new',
  present: 'knowledgeCenter.importOutcome.present',
  conflict: 'knowledgeCenter.importWritten.conflict',
  quarantine: 'knowledgeCenter.importWritten.quarantine',
};

const fileNameOf = (filePath: string): string => filePath.split(/[\\/]/).pop() ?? filePath;

interface ImportKnowledgeDialogProps {
  importer: ReturnType<typeof useKnowledgeImport>;
  candidates: ReturnType<typeof useKnowledgeCandidateInbox>;
  spaces: KnowledgeSpace[];
}

/** The one sentence an item needs beyond its status: why it is held back, or what it is missing. */
function ItemNote({ item }: { item: KnowledgeImportItem }) {
  const { t } = useI18n();
  const outcome = knowledgeImportOutcome(item);
  if (outcome === 'quarantine') {
    const reason = knowledgeQuarantineReason(item.reason);
    return <p className="knowledge-import-item-note">{t(reason ? `knowledgeCenter.importReason.${reason}` : 'knowledgeCenter.importStatusQuarantineHint')}</p>;
  }
  if (outcome === 'conflict') return <p className="knowledge-import-item-note">{t('knowledgeCenter.importConflictNote')}</p>;
  if (item.missingAssets.length > 0) {
    return <p className="knowledge-import-item-note">{t('knowledgeCenter.importMissingAssets', { count: item.missingAssets.length })}</p>;
  }
  return null;
}

function ImportItems({ items, written, candidates, onProposed }: {
  items: readonly KnowledgeImportItem[];
  written: boolean;
  candidates?: ImportKnowledgeDialogProps['candidates'];
  onProposed?: () => void;
}) {
  const { t } = useI18n();
  return (
    <ul className="knowledge-import-items" data-testid="knowledge-center-import-items">
      {items.map((item, index) => {
        const outcome = knowledgeImportOutcome(item);
        const type = item.record?.type;
        const images = item.record?.images?.length ?? 0;
        const meta = [type ? t(TYPE_LABEL_KEYS[type]) : null, images ? t('knowledgeCenter.importImageCount', { count: images }) : null].filter(Boolean);
        return (
          <li key={`${item.record?.cardId ?? item.status}:${index}`} className="knowledge-import-item" data-outcome={outcome}>
            <Icon name={type ? TYPE_ICONS[type] : 'warning'} size={16} className="knowledge-import-item-icon" />
            <div className="knowledge-import-item-copy">
              <span className="knowledge-import-item-title">{item.record?.title ?? t('knowledgeCenter.importUnreadable')}</span>
              {meta.length ? <span className="knowledge-import-item-meta">{meta.join(' · ')}</span> : null}
              <ItemNote item={item} />
              {candidates?.candidateError && candidates.candidateError.cardId === item.record?.cardId ? (
                <InlineError detail={candidates.candidateError.message}>{t('knowledgeCenter.candidateFailed')}</InlineError>
              ) : null}
            </div>
            <div className="knowledge-import-item-side">
              <Badge tone={OUTCOME_TONE[outcome]} data-status={outcome}>{t((written ? WRITTEN_LABEL_KEYS : OUTCOME_LABEL_KEYS)[outcome])}</Badge>
              {candidates && outcome === 'new' && item.record && candidates.hasSession && item.missingAssets.length === 0 ? (
                <Button variant="ghost" size="sm" disabled={candidates.busy} data-testid="knowledge-center-import-create-candidate"
                  onClick={() => void candidates.createCandidate(item.record!, onProposed)}>
                  {t('knowledgeCenter.importCreateCandidate')}
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function OutcomeSummary({ items, written }: { items: readonly KnowledgeImportItem[]; written: boolean }) {
  const { t } = useI18n();
  const counts = countKnowledgeImportOutcomes(items);
  const rest = (['present', 'conflict', 'quarantine'] as const).filter((outcome) => counts[outcome] > 0)
    .map((outcome) => t(`knowledgeCenter.importSummary.${outcome}`, { count: counts[outcome] }));
  return (
    <div className="knowledge-import-summary" data-testid="knowledge-center-import-summary">
      <h3>{t(written ? 'knowledgeCenter.importSummary.written' : 'knowledgeCenter.importSummary.planned', { count: counts.new })}</h3>
      {rest.length ? <p>{rest.join(t('knowledgeCenter.listSeparator'))}</p> : null}
    </div>
  );
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

  const footer = step === 'result' ? (
    <Button variant="primary" disabled={importer.busy} onClick={importer.close}>{t('knowledgeCenter.importDone')}</Button>
  ) : step === 'preview' ? (
    <>
      <Button variant="ghost" disabled={importer.busy} onClick={importer.back}>{t('knowledgeCenter.importBack')}</Button>
      <Button variant="primary" disabled={importer.busy || newCount === 0} data-testid="knowledge-center-import-run"
        onClick={() => void importer.importSource()}>
        {t('knowledgeCenter.importRunCount', { count: newCount })}
      </Button>
    </>
  ) : (
    <>
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

      {importer.error ? <InlineError data-testid="knowledge-center-import-error">{importer.error}</InlineError> : null}
    </TaskDialog>
  );
}
