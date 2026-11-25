import { useI18n, type TranslationKey } from '../../../../i18n';
import { OverflowFade } from '../../../../ui/OverflowFade';
import { ProgressBar } from '../../../../ui/ProgressBar';
import { Spinner } from '../../../../ui/Spinner';
import type { KnowledgeOperationPhase, KnowledgeOperationProgress } from '@shared/types/knowledgeOperation';
import './knowledge-task-progress.css';

export type KnowledgeOperationKind = 'import' | 'export' | 'rebuild';

/** What each task says while it runs: before main's first report, and then per phase with its counts. */
const OPERATION_LABEL_KEYS: Record<KnowledgeOperationKind, { starting: TranslationKey } & Partial<Record<KnowledgeOperationPhase, TranslationKey>>> = {
  import: { starting: 'knowledgeCenter.progressImporting', reading: 'knowledgeCenter.progressImportReading', writing: 'knowledgeCenter.progressImportWriting' },
  export: { starting: 'knowledgeCenter.progressExporting', reading: 'knowledgeCenter.progressExportReading', writing: 'knowledgeCenter.progressExportWriting' },
  rebuild: { starting: 'knowledgeCenter.progressRebuilding', indexing: 'knowledgeCenter.progressRebuildIndexing' },
};

/**
 * A long knowledge task in progress, stated beside the dialog's actions. Reading a source reports no counts, so it
 * says what is running with a spinner. An import, export or rebuild follows main's reports with a bar of real counts;
 * until the first report arrives the bar is empty and the line names the task.
 */
export function KnowledgeTaskProgress(props: { label: string } | { operation: KnowledgeOperationKind; progress: KnowledgeOperationProgress | null }) {
  const { t } = useI18n();
  if ('label' in props) {
    return (
      <span className="task-dialog-footer-spacer knowledge-task-progress" role="status" data-testid="knowledge-task-progress">
        <Spinner size="sm" />
        <span>{props.label}</span>
      </span>
    );
  }
  const { operation, progress } = props;
  const keys = OPERATION_LABEL_KEYS[operation];
  const phaseKey = progress ? keys[progress.phase] : undefined;
  const label = phaseKey && progress ? t(phaseKey, { done: progress.done, total: progress.total }) : t(keys.starting);
  return (
    <span className="task-dialog-footer-spacer knowledge-task-progress is-determinate" data-testid="knowledge-task-progress">
      <span role="status"><OverflowFade text={label} /></span>
      <ProgressBar
        value={progress?.done ?? 0}
        max={progress?.total ?? 0}
        label={t(keys.starting)}
        valueText={progress ? t('knowledgeCenter.progressValue', { done: progress.done, total: progress.total }) : undefined}
      />
    </span>
  );
}

/** A task the person cancelled, said once beside the actions as plain status text: a neutral outcome, not an error. */
export function KnowledgeTaskCancelled({ label }: { label: string }) {
  return <span className="task-dialog-footer-spacer" role="status" data-testid="knowledge-task-cancelled">{label}</span>;
}
