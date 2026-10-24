import type { CaptureReplayState } from '@shared/types/captureReplay';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import type { CaptureScope } from './capturePanelActions';
import { CaptureReplayControls } from './CaptureReplayControls';
import { useCapturePreview } from './useCapturePreview';

type CaptureWorkspaceProps = {
  scope: CaptureScope; state: CaptureReplayState | null;
  disabled: boolean; receive: (state: CaptureReplayState) => void;
};

export function CaptureWorkspace(props: CaptureWorkspaceProps) {
  return <ScopedCaptureWorkspace key={JSON.stringify([props.scope.projectId, props.scope.sessionId,
    props.state?.captureHash, props.state?.generation])} {...props} />;
}

function ScopedCaptureWorkspace({ scope, state, disabled, receive }: CaptureWorkspaceProps) {
  const { t } = useI18n();
  const live = Boolean(state?.contextId && state.phase !== 'closed');
  const lock = state?.interactionLock;
  const image = live ? state?.image : null;
  const preview = useCapturePreview(scope, { imagePath: image?.imagePath, imageRevision: image?.updatedAt });
  const phaseBusy = Boolean(state && ['validating', 'connecting', 'transferring', 'opening', 'loading_image', 'closing'].includes(state.phase));
  const busy = preview.loading || phaseBusy;
  const lockReason = lock === 'agent_running' ? 'control.replay.lockedAgent'
    : lock === 'delegated_execution' ? 'control.replay.lockedDelegation'
      : lock === 'native_exit_unconfirmed' ? 'control.replay.lockedUnconfirmed' : 'control.replay.locked';
  const ownership = lock === 'agent_running' || lock === 'delegated_execution' ? 'control.replay.controlAgent'
    : lock ? 'control.replay.controlLocked' : live ? 'control.replay.controlHuman' : 'control.replay.controlClosed';
  return <div className="capture-replay-content" aria-label={t('control.replay.workspace')}>
    <div className="capture-workspace-toolbar" role="status" title={lock ? t(lockReason) : undefined}>
      <span className={`capture-workspace-owner${lock ? ' is-locked' : ''}`}>{t(ownership)}</span>
      {live && state?.imageEventId != null && <span className="capture-workspace-eid">EID {state.imageEventId}</span>}
    </div>
    <div className="capture-replay-image" aria-busy={busy}>
      {preview.url ? <img src={preview.url} alt={`EID ${state?.imageEventId ?? '—'}`} />
        : <span>{preview.error ? t('control.replay.imageReadFailed') : busy ? t(phaseBusy && state ? `control.replay.${state.phase}` : 'control.replay.imageLoading') : t(live ? 'control.replay.noOutput' : 'control.replay.noImage')}</span>}
      {preview.url && busy && <span className="capture-image-state">{t('control.replay.imageLoading')}</span>}
    </div>
    {preview.error && <div className="capture-replay-feedback is-error" role="alert">
      <span>{t('control.replay.imageReadFailed')}</span>
      <Button variant="ghost" size="sm" onClick={preview.retry}>{t('control.replay.retryRead')}</Button>
    </div>}
    <CaptureReplayControls scope={scope} state={state} disabled={disabled || Boolean(lock) || !live} receive={receive} />
  </div>;
}
