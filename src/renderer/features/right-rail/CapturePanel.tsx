import { useCallback, useMemo, useState } from 'react';
import type { RdxContextPanelViewModel, TaskContextPanelViewModel } from '@shared/types/trace';
import { copyAppText } from '../../hooks/appShellBridge';
import { useDeviceStore } from '../../stores/deviceStore';
import { useProjectStore } from '../../stores/projectStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useSessionProjectionStore } from '../../stores/sessionProjectionStore';
import { Button } from '../../ui/Button';
import { DropdownSelect } from '../../ui/DropdownSelect';
import { useI18n } from '../../i18n';
import { CaptureFrame } from './CaptureFrame';
import { CaptureHistory } from './CaptureHistory';
import { useCaptureReplay } from './useCaptureReplay';
import { clearOpenedCapture, clearReplayHistory, getTraceProjection, openProjectCaptureInput, refreshProjectCaptureInputs, refreshReplayDevices, refreshReplayFrame, type CaptureScope } from './capturePanelActions';
import './CaptureReplay.css';

type Action = 'open' | 'close' | 'refresh' | 'image' | 'clearHistory';
const sizeLabel = (size: number) => size >= 1024 ** 3 ? `${(size / 1024 ** 3).toFixed(1)} GB` : `${(size / 1024 ** 2).toFixed(1)} MB`;

function ScopedCapturePanel({ scope, capture }: { scope: CaptureScope; capture: RdxContextPanelViewModel }) {
  const { t } = useI18n();
  const { state, selection, error: connectionError, reload, receive } = useCaptureReplay(scope);
  const devices = useDeviceStore((value) => value.devices);
  const [draft, setDraft] = useState<{ inputId: string; deviceId: string } | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [error, setError] = useState<{ message: string; action: Action } | null>(null);
  const [tab, setTab] = useState<'frame' | 'history'>('frame');
  const [more, setMore] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const [copied, setCopied] = useState(false);
  const actualInputId = state?.inputId ?? selection?.inputId ?? capture.availableCaptures[0]?.inputId ?? '';
  const actualDeviceId = state?.replayDeviceId ?? selection?.deviceId ?? 'local';
  const chosen = draft ?? { inputId: actualInputId, deviceId: actualDeviceId };
  const selectedInput = capture.availableCaptures.find((input) => input.inputId === chosen.inputId) ?? capture.availableCaptures[0];
  const open = Boolean(state?.contextId);
  const pending = open && (chosen.inputId !== actualInputId || chosen.deviceId !== actualDeviceId);
  const phaseBusy = Boolean(state && ['validating', 'connecting', 'transferring', 'opening', 'loading_image', 'closing'].includes(state.phase));
  const locked = Boolean(state?.interactionLock);
  const disabled = locked || phaseBusy || action !== null || !state;
  const captureHash = state?.captureHash ?? selection?.captureSha256 ?? null;
  const partial = state?.phase === 'ready' && Boolean(state.error || state.warning || ['unsupported', 'error', 'pending'].includes(state.devicePresentation.status));
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
        const result = await openProjectCaptureInput({ ...scope, bindingGeneration: state.generation, inputId: selectedInput.inputId, filePath: selectedInput.filePath, replayDeviceId: chosen.deviceId });
        if (!result.success) throw new Error(result.error);
        setDraft(null);
      } else if (operation === 'close') {
        const result = await clearOpenedCapture({ ...scope, bindingGeneration: state.generation });
        if (!result.success) throw new Error(result.error);
      } else if (operation === 'image') receive(await refreshReplayFrame({ ...scope, bindingGeneration: state.generation }));
      else if (operation === 'refresh') {
        const [result, nextDevices] = await Promise.all([refreshProjectCaptureInputs(scope.projectId), refreshReplayDevices()]);
        useDeviceStore.getState().setDevices(nextDevices);
        useProjectStore.getState().updateProjectInputs(scope.projectId, result.inputs);
      } else if (operation === 'clearHistory' && captureHash) {
        await clearReplayHistory({ ...scope, captureHash });
        setConfirmClear(false); setMore(false); setHistoryEpoch((value) => value + 1);
      }
      await refreshProjection();
    } catch (reason) { setError({ message: reason instanceof Error ? reason.message : String(reason), action: operation }); }
    finally { setAction(null); }
  };
  const imageErrorKeys: Record<string, Parameters<typeof t>[0]> = { no_color_output: 'control.replay.noOutput', missing_target: 'control.replay.missingTarget', export_failure: 'control.replay.exportFailed' };
  const diagnostic = error?.message ?? connectionError ?? (state?.error ? imageErrorKeys[state.error.code] ? t(imageErrorKeys[state.error.code]) : state.error.message : null);
  const retry: Action = error?.action ?? (state?.error?.retry === 'close' ? 'close' : state?.error?.retry === 'open' ? 'open' : 'image');
  return <div className="capture-replay-panel" aria-label={t('control.rightRail.capture.controls')}>
    <div className="capture-replay-status-row">
      <h2 className="right-rail-section-heading">{t('control.rightRail.capture.title')}</h2>
      <span role="status" className={`capture-replay-status${state?.error ? ' is-error' : ''}`}>{pending ? t('control.replay.pending') : partial ? t('control.replay.partial') : t(`control.replay.${state?.phase ?? 'closed'}`)}</span>
      <Button variant="ghost" size="sm" aria-label={t('control.replay.more')} aria-expanded={more} onClick={() => setMore(!more)}>⋯</Button>
    </div>
    {more && <div className="capture-replay-menu">
      <Button variant="ghost" size="sm" disabled={!state?.contextId} onClick={() => {
        if (state?.contextId) void copyAppText(state.contextId).then(() => setCopied(true)).catch((reason) => setError({ message: String(reason), action: 'refresh' }));
      }}>{t(copied ? 'control.replay.copied' : 'control.replay.copyContext')}</Button>
      <Button variant="ghost" size="sm" disabled={disabled || !captureHash} onClick={() => setConfirmClear(true)}>{t('control.replay.clearHistory')}</Button>
      {confirmClear && <><span>{t('control.replay.clearConfirm')}</span><Button variant="danger" size="sm" disabled={disabled} onClick={() => void run('clearHistory')}>{t('control.replay.confirm')}</Button><Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>{t('control.replay.cancel')}</Button></>}
    </div>}
    <div className="capture-replay-file-row" title={selectedInput?.filePath}>
      <DropdownSelect dataTestId="right-rail-capture-input" ariaLabel={t('control.rightRail.capture.title')} value={selectedInput?.inputId ?? ''}
        options={capture.availableCaptures.map((input) => ({ value: input.inputId, label: input.fileName }))} disabled={disabled}
        onChange={(inputId) => setDraft({ ...chosen, inputId })} />
      <small>{selectedInput ? sizeLabel(selectedInput.sizeBytes) : ''}</small>
    </div>
    <div className="capture-replay-device-row">
      <DropdownSelect dataTestId="right-rail-replay-device" ariaLabel={t('control.sessionContextDevice')} value={chosen.deviceId} disabled={disabled}
        options={devices.map((device) => ({ value: device.id, label: device.type === 'local' ? t('device.local') : device.label, disabled: !['online', 'connected'].includes(device.status) }))}
        onChange={(deviceId) => setDraft({ ...chosen, deviceId })} />
      <Button variant="ghost" size="sm" aria-label={t('control.replay.refresh')} aria-busy={action === 'refresh'} disabled={disabled} onClick={() => void run('refresh')}>↻</Button>
      <Button variant={open ? 'secondary' : 'primary'} size="sm" disabled={disabled || !selectedInput} onClick={() => void run(pending || !open ? 'open' : 'close')}>{t(pending ? 'control.replay.switch' : open ? 'control.replay.close' : 'control.captureOpen')}</Button>
    </div>
    {pending && <div className="capture-replay-pending"><small>{capture.availableCaptures.find((input) => input.inputId === actualInputId)?.fileName} · {devices.find((device) => device.id === actualDeviceId)?.label}</small><Button variant="ghost" size="sm" disabled={disabled} onClick={() => setDraft(null)}>{t('control.replay.cancel')}</Button></div>}
    {locked && <div className="capture-replay-feedback" role="status" title={state?.interactionLock ?? undefined}>{t('control.replay.locked')}</div>}
    {state?.warning && <div className="capture-replay-feedback" role="status">{state.warning.message}</div>}
    <div className="capture-replay-tabs" role="tablist" aria-label={t('control.rightRail.capture.title')}>
      {(['frame', 'history'] as const).map((id) => <Button key={id} variant="ghost" size="sm" role="tab" id={`capture-${id}-tab`} aria-controls={`capture-${id}-panel`} aria-selected={tab === id}
        tabIndex={tab === id ? 0 : -1} className={tab === id ? 'is-selected' : ''} onClick={() => setTab(id)} onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'frame' : event.key === 'End' ? 'history' : id === 'frame' ? 'history' : 'frame'; setTab(next); document.getElementById(`capture-${next}-tab`)?.focus(); }
        }}>{t(`control.replay.${id}`)}</Button>)}
    </div>
    <div hidden={tab !== 'frame'}><CaptureFrame scope={scope} state={state} disabled={disabled || !open || pending || tab !== 'frame' || state?.error?.retry === 'close'} receive={receive} /></div>
    <div hidden={tab !== 'history'}><CaptureHistory key={`${captureHash ?? 'none'}:${historyEpoch}`} scope={scope} captureHash={captureHash} state={state} active={tab === 'history'} /></div>
    {diagnostic && <div className="capture-replay-feedback is-error" role="alert"><span>{diagnostic}</span>{(error || state?.error?.retry) && <Button variant="ghost" size="sm" disabled={disabled} onClick={() => void run(retry)}>{t(retry === 'close' ? 'control.replay.retryClose' : retry === 'open' ? 'control.replay.retryOpen' : 'control.replay.retryImage')}</Button>}</div>}
  </div>;
}

export function CapturePanel({ task, capture }: { task: TaskContextPanelViewModel; capture: RdxContextPanelViewModel }) {
  const { t } = useI18n();
  const scope = useMemo(() => task.projectId && task.sessionId ? { projectId: task.projectId, sessionId: task.sessionId } : null, [task.projectId, task.sessionId]);
  return scope ? <ScopedCapturePanel key={`${scope.projectId}:${scope.sessionId}`} scope={scope} capture={capture} /> : <span>{t('control.replay.noSession')}</span>;
}
