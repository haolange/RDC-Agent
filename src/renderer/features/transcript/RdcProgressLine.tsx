import { useI18n, type TranslationKey } from '../../i18n';
import { CopyDiagnosticsButton } from '../../patterns/CopyDiagnostics';
import { useToolProgressStore } from '../../stores/toolProgressStore';
import { useWorkClock } from './useWorkClock';
import type { ReactNode } from 'react';
import type { RdcOperationProgress } from '@shared/types/agentRuntime';

/** After this much silence the row says how long the operation has reported nothing. */
export const RDC_QUIET_NOTICE_MS = 30_000;

/** RDC-Tool stages the product names; any other stage reads as generic work, never as its raw identifier. */
const STAGE_KEYS: Readonly<Record<string, TranslationKey>> = {
  capture_transfer_started: 'chat.rdcProgressTransferring',
  capture_transfer_progress: 'chat.rdcProgressTransferring',
  capture_transfer_done: 'chat.rdcProgressOpening',
  capture_open_done: 'chat.rdcProgressOpening',
  checking: 'chat.rdcProgressChecking',
  installing: 'chat.rdcProgressInstalling',
  starting: 'chat.rdcProgressStarting',
  verifying: 'chat.rdcProgressVerifying',
};

/**
 * The subtitle of a running RDC tool row: what the operation is doing and, once it has been quiet for a while, for
 * how long. The elapsed time is the row's own duration; operation and native-call names stay in copy diagnostics.
 */
export function RdcProgressLine({ progress }: { progress: RdcOperationProgress }) {
  const { t, language } = useI18n();
  const now = useWorkClock(true) ?? progress.lastProgressAt;
  const stage =
    progress.state === 'queued'
      ? t('chat.rdcProgressQueued')
      : t((progress.stage === null ? undefined : STAGE_KEYS[progress.stage]) ?? 'chat.rdcProgressWorking');
  const percent =
    progress.state === 'running' && progress.progressPct !== null
      ? new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 0 }).format(
          Math.min(100, Math.max(0, progress.progressPct)) / 100,
        )
      : null;
  const quietMs = now - progress.lastProgressAt;
  const quiet =
    progress.state === 'running' && quietMs >= RDC_QUIET_NOTICE_MS
      ? t('chat.rdcProgressQuiet', { seconds: Math.floor(quietMs / 1000) })
      : null;
  return (
    <span className="work-process-rdc-progress" data-testid="work-process-rdc-progress">
      {[stage, percent, quiet].filter(Boolean).join(' · ')}
    </span>
  );
}

/** The technical facts behind the progress line, for whoever needs them. */
export function RdcProgressDiagnostics({ progress }: { progress: RdcOperationProgress }) {
  const { t } = useI18n();
  return (
    <CopyDiagnosticsButton
      className="work-process-rdc-progress-diagnostics"
      testId="work-process-rdc-progress-diagnostics"
      facts={[
        { label: t('chat.rdcProgressOperation'), value: progress.operation },
        { label: t('chat.rdcProgressStage'), value: progress.stage },
        { label: t('chat.rdcProgressNativeCall'), value: progress.nativeCall },
        { label: t('chat.rdcProgressLastProgress'), value: new Date(progress.lastProgressAt).toISOString() },
      ]}
    />
  );
}

/** A running call's progress subtitle and its copy-diagnostics action; both absent while it reports none. */
export function useRdcProgressSlots(
  toolCallId: string,
  running: boolean,
): { line?: ReactNode; diagnostics?: ReactNode } {
  const progress = useToolProgressStore((state) => (running ? state.byToolCall[toolCallId] : undefined));
  return progress
    ? { line: <RdcProgressLine progress={progress} />, diagnostics: <RdcProgressDiagnostics progress={progress} /> }
    : {};
}
