import { useCallback, useMemo, useState } from 'react';
import type { RdcContextPanelViewModel, TaskContextPanelViewModel } from '@shared/types/trace';
import { copyAppText } from '../../hooks/appShellBridge';
import { useDeviceStore } from '../../stores/deviceStore';
import { useSessionDeviceStore } from '../../stores/sessionDeviceStore';
import { DevicePreparationStatus, isDevicePreparing, isDeviceInstallationUnconfirmed } from '../../patterns/DevicePreparationStatus';
import { useProjectStore } from '../../stores/projectStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useSessionProjectionStore } from '../../stores/sessionProjectionStore';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Select';
import { useI18n } from '../../i18n';
import { CaptureWorkspace } from './CaptureWorkspace';
import {
  CaptureReplayCallouts,
  CaptureReplayStatusChip,
  FACT_LABELS,
  captureStatusLabelKey,
  collectCaptureCallouts,
  isCapturePartialReady,
  resolveCaptureStatusTone,
} from './CaptureReplayStatus';
import { useCaptureReplay } from './useCaptureReplay';
import { useCaptureRecovery } from './useCaptureRecovery';
import { clearOpenedCapture, getTraceProjection, openProjectCaptureInput, refreshProjectCaptureInputs, refreshReplayDevices, refreshReplayFrame, type CaptureScope } from './capturePanelActions';
import './CaptureReplay.css';

type Action = 'open' | 'close' | 'refresh' | 'image';
const sizeLabel = (size: number) => size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(1)} GB` : `${(size / 1024 ** 2).toFixed(1)} MB`;

function ScopedCapturePanel({ scope, capture }: { scope: CaptureScope; capture: RdcContextPanelViewModel }) {
  const { t } = useI18n();
  const { state, selection, error: connectionError, actionFailure, reload, receive } = useCaptureReplay(scope);
  const recovery = useCaptureRecovery(scope, state?.revision);
  const devices = useDeviceStore((value) => value.devices);
  const [draft, setDraft] = useState<{ inputId: string } | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<{ message: string; action: Action } | null>(null);
  const [more, setMore] = useState(false);
  const [copied, setCopied] = useState(false);
  const actualInputId = state?.inputId ?? selection?.inputId ?? capture.availableCaptures[0]?.inputId ?? '';
  const actualDeviceId = state?.replayDeviceId ?? 'local';
  const targetDeviceId = state?.preparation.targetDeviceId ?? actualDeviceId;
  const chosen = draft ?? { inputId: actualInputId };
  const selectedInput = capture.availableCaptures.find((input) => input.inputId === chosen.inputId) ?? capture.availableCaptures[0];
  const open = Boolean(state?.inputId && state.contextId);
  const pending = open && chosen.inputId !== actualInputId;
  const phaseBusy = Boolean(state && ['validating', 'connecting', 'transferring', 'opening', 'loading_image', 'closing'].includes(state.phase));
  const locked = Boolean(state?.interactionLock);
  const preparing = state ? isDevicePreparing(state.preparation.phase) : false;
  const installUnconfirmed = isDeviceInstallationUnconfirmed(state?.preparation);
  const disabled = locked || installUnconfirmed || phaseBusy || preparing || restoring || action !== null || !state;
  const deviceDisabled = locked || installUnconfirmed || (!preparing && phaseBusy) || restoring || action !== null || !state;
  const deviceReady = targetDeviceId === 'local' || state?.preparation.phase === 'ready';
  const partial = isCapturePartialReady(state);
  const refreshProjection = useCallback(async () => {
    await reload();
    const result = await getTraceProjection(scope.sessionId);
    if (result.success && result.presentation) {
      useSessionProjectionStore.getState().projectTrace(scope.sessionId, result.presentation);
      if (useProjectStore.getState().currentSession?.sessionId === scope.sessionId) useWorkflowStore.getState().setTracePresentation(result.presentation);
    }
  }, [reload, scope]);
  const run = async (operation: Action) => {
    if (disabled || !state) return;
    setAction(operation); setError(null);
    try {
      if (operation === 'open' && selectedInput) {
        const result = await openProjectCaptureInput({ ...scope, bindingGeneration: state.generation, inputId: selectedInput.inputId, filePath: selectedInput.filePath, replayDeviceId: targetDeviceId });
        if (!result.success) {
          if (result.issue) { setError({ message: result.issue.diagnostic, action: operation }); await reload(); return; }
          throw new Error(result.error);
        }
        setDraft(null);
      } else if (operation === 'close') {
        const result = await clearOpenedCapture({ ...scope, bindingGeneration: state.generation });
        if (!result.success) throw new Error(result.error);
      } else if (operation === 'image') receive(await refreshReplayFrame({ ...scope, bindingGeneration: state.generation }));
      else if (operation === 'refresh') {
        const [result, nextDevices] = await Promise.all([refreshProjectCaptureInputs(scope.projectId), refreshReplayDevices()]);
        useDeviceStore.getState().applyStatusPayload(nextDevices);
        useProjectStore.getState().updateProjectInputs(scope.projectId, result.inputs);
      }
      if (operation === 'refresh') await refreshProjection();
    } catch (reason) { setError({ message: reason instanceof Error ? reason.message : String(reason), action: operation }); }
    finally { setAction(null); }
  };
  const statusTone = resolveCaptureStatusTone({ phase: state?.phase, pending, partial });
  const callouts = collectCaptureCallouts({
    failureTitle: t('control.replay.actionFailed'),
    warning: state?.warning ?? null,
    finalPresentTitle: t('control.replay.finalPresentUnavailable'),
    actionError: state?.preparation.issue ? null : error,
    connectionError,
    stateError: state?.preparation.issue ? null : state?.error ?? null,
    factLabels: {
      no_color_output: t(FACT_LABELS.no_color_output),
      missing_target: t(FACT_LABELS.missing_target),
      export_failure: t(FACT_LABELS.export_failure),
    },
  });
  return <div className="capture-replay-panel" aria-label={t('control.rightRail.capture.controls')}>
    <div className="capture-replay-status-row">
      <h2 className="right-rail-section-heading">{t('control.rightRail.capture.title')}</h2>
      <CaptureReplayStatusChip label={t(captureStatusLabelKey({ pending, partial, phase: state?.phase }))} tone={statusTone} />
      <Button variant="ghost" size="sm" aria-label={t('control.replay.more')} aria-expanded={more} onClick={() => setMore(!more)}>⋯</Button>
    </div>
    {more && <div className="capture-replay-menu">
      <Button variant="ghost" size="sm" disabled={!state?.contextId} onClick={() => {
        if (state?.contextId) void copyAppText(state.contextId).then(() => setCopied(true)).catch((reason) => setError({ message: String(reason), action: 'refresh' }));
      }}>{t(copied ? 'control.replay.copied' : 'control.replay.copyContext')}</Button>
    </div>}
    <div className="capture-replay-file-row" title={selectedInput?.filePath}>
      <Select dataTestId="right-rail-capture-input" ariaLabel={t('control.rightRail.capture.title')} value={selectedInput?.inputId ?? ''}
        options={capture.availableCaptures.map((input) => ({ value: input.inputId, label: input.fileName }))} disabled={disabled}
        onChange={(inputId) => setDraft({ ...chosen, inputId })} />
      <small>{selectedInput ? sizeLabel(selectedInput.sizeBytes) : ''}</small>
    </div>
    <div className="capture-replay-device-row">
      <Select dataTestId="right-rail-replay-device" ariaLabel={t('control.sessionContextDevice')} value={targetDeviceId} disabled={deviceDisabled}
        options={[...devices.map((device) => ({ value: device.id, label: device.type === 'local' ? t('device.local') : device.label, disabled: device.type === 'android' && device.adbState !== 'device' })), ...(devices.some((device) => device.id === targetDeviceId) ? [] : [{ value: targetDeviceId, label: targetDeviceId, disabled: true }])]}
        onChange={(deviceId) => { void useSessionDeviceStore.getState().prepare(scope, deviceId); }} />
      <Button variant="ghost" size="sm" aria-label={t('control.replay.refresh')} aria-busy={action === 'refresh'} disabled={disabled} onClick={() => void run('refresh')}>↻</Button>
      <Button variant={open ? 'secondary' : 'primary'} size="sm" disabled={disabled || !selectedInput || (!open && !deviceReady)} onClick={() => void run(pending || !open ? 'open' : 'close')}>{t(pending ? 'control.replay.switch' : open ? 'control.replay.close' : 'control.captureOpen')}</Button>
    </div>
    {pending && <div className="capture-replay-pending"><small>{capture.availableCaptures.find((input) => input.inputId === actualInputId)?.fileName} · {devices.find((device) => device.id === actualDeviceId)?.label}</small><Button variant="ghost" size="sm" disabled={disabled} onClick={() => setDraft(null)}>{t('control.replay.cancel')}</Button></div>}
    {recovery.status && <div className="capture-replay-callout is-warning" aria-live="polite">
      <div className="capture-replay-callout-copy"><strong>{t(locked ? 'control.replay.recoveryOwned' : 'control.replay.recoveryPending')}</strong>
        <small>{recovery.status.original ? `${recovery.status.original.fileName} · ${recovery.status.original.deviceId} · EID ${recovery.status.original.eventId}` : t('control.replay.recoveryNoCapture')}</small>
        <small>{t('control.replay.recoveryDescription')}</small></div>
      <Button variant="secondary" size="sm" disabled={disabled} aria-busy={restoring} onClick={() => {
        if (!state) return;
        setRestoring(true);
        void recovery.restore(state.generation).then(async next => { if (next) { receive(next); await refreshProjection(); } }).finally(() => setRestoring(false));
      }}>{t('control.replay.recoveryAction')}</Button>
    </div>}
    {recovery.error && <div className="capture-replay-callout is-error" role="alert"><div className="capture-replay-callout-copy"><strong>{t('control.replay.recoveryFailed')}</strong><small>{recovery.error}</small></div></div>}
    <DevicePreparationStatus preparation={state?.preparation ?? null} issue={actionFailure?.issue} hasCapture={open} disabled={locked}
      onRetry={() => { void useSessionDeviceStore.getState().prepare(scope, installUnconfirmed ? targetDeviceId : actionFailure?.deviceId ?? targetDeviceId); }}
      onCancel={() => useSessionDeviceStore.getState().cancel(scope)} />
    <CaptureReplayCallouts
      callouts={callouts}
      detailLabel={t('device.prepare.details')}
      disabled={disabled}
      retryLabels={{ open: t('control.replay.retryOpen'), close: t('control.replay.retryClose'), image: t('control.replay.retryImage') }}
      onRetry={(operation) => void run(operation)}
    />
    <CaptureWorkspace scope={scope} state={state}
      disabled={disabled || !open || pending || state?.error?.retry === 'close'} receive={receive} />
  </div>;
}

export function CapturePanel({ task, capture }: { task: TaskContextPanelViewModel; capture: RdcContextPanelViewModel }) {
  const { t } = useI18n();
  const scope = useMemo(() => task.projectId && task.sessionId ? { projectId: task.projectId, sessionId: task.sessionId } : null, [task.projectId, task.sessionId]);
  return scope ? <ScopedCapturePanel key={`${scope.projectId}:${scope.sessionId}`} scope={scope} capture={capture} /> : <span>{t('control.replay.noSession')}</span>;
}
