import { InlineError } from '../../ui/InlineError';
import type { CaptureReplayError, CaptureReplayPhase, CaptureReplayState } from '@shared/types/captureReplay';
import type { TranslationKey } from '../../i18n';

export type CaptureRetryAction = 'open' | 'close' | 'refresh' | 'image';
export type CaptureStatusTone = 'success' | 'warning' | 'error' | 'info';
export type CaptureCalloutTone = 'warning' | 'info' | 'error';

export interface CaptureCallout {
  id: string;
  tone: CaptureCalloutTone;
  title: string;
  detail?: string;
  retry?: CaptureRetryAction;
}

const FACT_LABELS: Record<string, TranslationKey> = {
  no_color_output: 'control.replay.noOutput',
  missing_target: 'control.replay.missingTarget',
  export_failure: 'control.replay.exportFailed',
};

const BUSY_PHASES = new Set<CaptureReplayPhase>([
  'validating',
  'connecting',
  'transferring',
  'opening',
  'loading_image',
  'closing',
  'applying',
]);

export function isCapturePartialReady(state: CaptureReplayState | null): boolean {
  return (
    state?.phase === 'ready' &&
    Boolean(state.error || state.warning || ['unsupported', 'unavailable'].includes(state.devicePresentation.status))
  );
}

export function resolveCaptureStatusTone(args: {
  phase: CaptureReplayPhase | undefined;
  pending: boolean;
  partial: boolean;
}): CaptureStatusTone {
  if (args.pending || (args.phase && BUSY_PHASES.has(args.phase))) return 'info';
  if (args.phase === 'error') return 'error';
  if (args.partial) return 'warning';
  if (args.phase === 'ready') return 'success';
  return 'info';
}

export function collectCaptureCallouts(args: {
  failureTitle: string;
  actionFailureTitles?: Partial<Record<CaptureRetryAction, string>>;
  warning: { code: string; message: string } | null;
  finalPresentTitle: string;
  /** `title` words a coded failure; without one the action's own title stands. */
  actionError: { message: string; action: CaptureRetryAction; title?: string } | null;
  connectionError: string | null;
  stateError: CaptureReplayError | null;
  factLabels: { no_color_output: string; missing_target: string; export_failure: string };
}): CaptureCallout[] {
  const items: CaptureCallout[] = [];
  // The only replay warning is the final-output one; its tool text is a detail, never the title.
  if (args.warning) {
    items.push({
      id: `warning:${args.warning.code}`,
      tone: 'warning',
      title: args.finalPresentTitle,
      detail: args.warning.message,
    });
  }
  if (args.actionError) {
    items.push({
      id: 'action',
      tone: 'error',
      title: args.actionError.title ?? args.actionFailureTitles?.[args.actionError.action] ?? args.failureTitle,
      detail: args.actionError.message,
      retry: args.actionError.action,
    });
    return items;
  }
  if (args.connectionError) {
    items.push({
      id: 'connection',
      tone: 'error',
      title: args.actionFailureTitles?.refresh ?? args.failureTitle,
      detail: args.connectionError,
      retry: 'refresh',
    });
    return items;
  }
  const error = args.stateError;
  if (!error) return items;
  if (error.code === 'no_color_output') return items;
  if (error.code === 'missing_target') {
    items.push({ id: 'missing_target', tone: 'info', title: args.factLabels.missing_target });
    return items;
  }
  items.push({
    id: `error:${error.code}`,
    tone: 'error',
    title: error.code === 'export_failure' ? args.factLabels.export_failure : args.failureTitle,
    detail: error.message,
    retry:
      error.retry === 'close'
        ? 'close'
        : error.retry === 'open'
          ? 'open'
          : error.retry === 'apply'
            ? 'image'
            : (error.retry ?? undefined),
  });
  return items;
}

export function captureStatusLabelKey(args: {
  pending: boolean;
  partial: boolean;
  phase: CaptureReplayPhase | undefined;
}): TranslationKey {
  if (args.pending) return 'control.replay.pending';
  if (args.partial) return 'control.replay.partial';
  return `control.replay.${args.phase ?? 'closed'}` as TranslationKey;
}

export function CaptureReplayStatusChip({ label, tone }: { label: string; tone: CaptureStatusTone }) {
  return (
    <span role="status" className={`capture-replay-status is-${tone}`}>
      {label}
    </span>
  );
}

export function CaptureReplayCallouts({
  callouts,
  disabled,
  refreshDisabled,
  retryLabels,
  onRetry,
}: {
  callouts: CaptureCallout[];
  disabled: boolean;
  refreshDisabled: boolean;
  retryLabels: Record<CaptureRetryAction, string>;
  onRetry: (action: CaptureRetryAction) => void;
}) {
  if (!callouts.length) return null;
  return (
    <div className="capture-replay-callouts">
      {callouts.map(({ id, tone, title, detail, retry }) =>
        tone === 'error' ? (
          <InlineError
            key={id}
            detail={detail}
            retryDisabled={retry === 'refresh' ? refreshDisabled : disabled}
            onRetry={retry ? () => onRetry(retry) : undefined}
            retryLabel={retry ? retryLabels[retry] : undefined}
          >
            {title}
          </InlineError>
        ) : (
          <div key={id} className={`capture-replay-callout is-${tone}`} role="status">
            <span>{title}</span>
          </div>
        ),
      )}
    </div>
  );
}

export { FACT_LABELS };
