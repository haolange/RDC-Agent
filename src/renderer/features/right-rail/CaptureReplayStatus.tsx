import type { CaptureReplayError, CaptureReplayPhase, CaptureReplayState } from '@shared/types/captureReplay';
import type { TranslationKey } from '../../i18n';
import { Button } from '../../ui/Button';

export type CaptureRetryAction = 'open' | 'close' | 'refresh' | 'image' | 'clearHistory';
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
  'validating', 'connecting', 'transferring', 'opening', 'loading_image', 'closing', 'applying',
]);

export function isCapturePartialReady(state: CaptureReplayState | null): boolean {
  return state?.phase === 'ready' && Boolean(
    state.error
    || state.warning
    || ['unsupported', 'error', 'pending'].includes(state.devicePresentation.status),
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
  locked: boolean;
  lockedLabel: string;
  warning: { code: string; message: string } | null;
  finalPresentTitle: string;
  actionError: { message: string; action: CaptureRetryAction } | null;
  connectionError: string | null;
  stateError: CaptureReplayError | null;
  factLabels: { no_color_output: string; missing_target: string; export_failure: string };
}): CaptureCallout[] {
  const items: CaptureCallout[] = [];
  if (args.locked) items.push({ id: 'locked', tone: 'info', title: args.lockedLabel });
  if (args.warning) {
    items.push({
      id: `warning:${args.warning.code}`,
      tone: 'warning',
      title: args.warning.code === 'final_output_unavailable' ? args.finalPresentTitle : args.warning.message,
      detail: args.warning.code === 'final_output_unavailable' ? args.warning.message : undefined,
    });
  }
  if (args.actionError) {
    items.push({ id: 'action', tone: 'error', title: args.actionError.message, retry: args.actionError.action });
    return items;
  }
  if (args.connectionError) {
    items.push({ id: 'connection', tone: 'error', title: args.connectionError, retry: 'refresh' });
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
    title: error.code === 'export_failure' ? args.factLabels.export_failure : error.message,
    retry: error.retry === 'close' ? 'close' : error.retry === 'open' ? 'open' : error.retry === 'apply' ? 'image' : error.retry ?? undefined,
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
  return <span role="status" className={`capture-replay-status is-${tone}`}>{label}</span>;
}

export function CaptureReplayCallouts({
  callouts,
  disabled,
  retryLabels,
  onRetry,
}: {
  callouts: CaptureCallout[];
  disabled: boolean;
  retryLabels: Record<'open' | 'close' | 'image', string>;
  onRetry: (action: CaptureRetryAction) => void;
}) {
  if (!callouts.length) return null;
  return (
    <div className="capture-replay-callouts">
      {callouts.map((item) => (
        <div key={item.id} className={`capture-replay-callout is-${item.tone}`} role={item.tone === 'error' ? 'alert' : 'status'}>
          <div className="capture-replay-callout-copy">
            <strong>{item.title}</strong>
            {item.detail ? <small>{item.detail}</small> : null}
          </div>
          {item.retry ? (
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onRetry(item.retry!)}>
              {item.retry === 'close' ? retryLabels.close : item.retry === 'open' ? retryLabels.open : retryLabels.image}
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export { FACT_LABELS };