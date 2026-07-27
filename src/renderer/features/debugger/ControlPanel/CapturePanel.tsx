import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { RdxContextCaptureInput, RdxContextDiagnostic, RdxContextPanelViewModel, TaskContextPanelViewModel } from '@shared/types/trace';
import { getElectronApi } from '../../../platform/getElectronApi';
import { useDeviceStore } from '../../../stores/deviceStore';
import { useSessionProjectionStore } from '../../../stores/sessionProjectionStore';
import { useWorkflowStore } from '../../../stores/workflowStore';
import { Button } from '../../../ui/Button';
import { DropdownSelect, type DropdownOption } from '../../../ui/DropdownSelect';
import { compactActionError } from './rightRailErrorUtils';

type ActionName = 'open' | 'preview' | 'clear' | 'refresh' | null;

const formatSize = (size?: number): string => typeof size !== 'number' ? '' : size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;

const CaptureFileGlyph: React.FC = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 3.5h7l5 5V20.5H6z" />
    <path d="M13 3.5v5h5M9 14h6M9 17h4" />
  </svg>
);

export const CapturePanel: React.FC<{ task: TaskContextPanelViewModel; capture: RdxContextPanelViewModel }> = ({ task, capture: rdx }) => {
  const devices = useDeviceStore((state) => state.devices);
  const selectedDevice = useDeviceStore((state) => state.selectedDevice);
  const setSelectedDevice = useDeviceStore((state) => state.setSelectedDevice);
  const refreshDevices = useDeviceStore((state) => state.refreshDevices);
  const [selectedInputId, setSelectedInputId] = useState('');
  const [activeAction, setActiveAction] = useState<ActionName>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const scope = useMemo(
    () => task.projectId && task.sessionId ? { projectId: task.projectId, sessionId: task.sessionId } : null,
    [task.projectId, task.sessionId],
  );
  const selectedInput = useMemo(
    () => rdx.availableCaptures.find((item) => item.inputId === selectedInputId) ?? rdx.availableCaptures.find((item) => item.inputId === rdx.capture?.inputId) ?? rdx.availableCaptures[0] ?? null,
    [rdx.availableCaptures, rdx.capture?.inputId, selectedInputId],
  );
  const captureOptions = useMemo<DropdownOption[]>(() => rdx.availableCaptures.map((input) => ({
    value: input.inputId,
    label: `${input.fileName}${formatSize(input.sizeBytes) ? ` (${formatSize(input.sizeBytes)})` : ''}`,
  })), [rdx.availableCaptures]);
  const deviceOptions = useMemo<DropdownOption[]>(() => devices.map((device) => ({
    value: device.id,
    label: device.label,
  })), [devices]);
  useEffect(() => setSelectedInputId(selectedInput?.inputId ?? ''), [selectedInput?.inputId]);
  const refreshProjection = useCallback(async () => {
    if (!scope) return;
    const api = getElectronApi();
    if (!api) return;
    const [openedCapture, contextSnapshot, traceResult] = await Promise.all([
      api.capture.getOpenedState(scope).catch(() => null), api.context.get(scope).catch(() => null), api.trace.getProjection(scope.sessionId).catch(() => ({ success: false, presentation: null })),
    ]);
    const projection = useSessionProjectionStore.getState();
    projection.projectOpenedCapture(scope.sessionId, openedCapture);
    projection.projectContextSnapshot(scope.sessionId, contextSnapshot);
    if (traceResult.success && traceResult.presentation) {
      projection.projectTrace(scope.sessionId, traceResult.presentation);
      useWorkflowStore.getState().setTracePresentation(traceResult.presentation);
    }
  }, [scope]);
  useEffect(() => { void refreshProjection(); }, [refreshProjection]);
  const runAction = async (action: Exclude<ActionName, null>, body: () => Promise<string | null | undefined>) => {
    setActiveAction(action); setActionError(null);
    try { setActionError((await body()) || null); await refreshProjection(); } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); } finally { setActiveAction(null); }
  };
  const openInput = (input: RdxContextCaptureInput | null = selectedInput) => runAction('open', async () => !scope || !input ? null : (await getElectronApi()?.capture.openProjectInput({ ...scope, inputId: input.inputId, filePath: input.filePath, replayDeviceId: selectedDevice }))?.error);
  const togglePreview = () => runAction('preview', async () => {
    if (!scope) return null;
    const api = getElectronApi();
    return rdx.capture?.humanPreviewStatus === 'open' ? (await api?.context.closeHumanPreview(scope))?.error : (await api?.context.openHumanPreview(scope))?.error;
  });
  const clearCapture = () => runAction('clear', async () => scope ? (await getElectronApi()?.capture.clearOpenedState(scope))?.error : null);
  const copyRuntimeContext = () => {
    const value = rdx.runtime.contextId ?? rdx.runtime.replaySessionId ?? rdx.capture?.replaySessionId;
    if (value) void getElectronApi()?.appShell.copyText(value);
  };
  const diagnostic = useMemo(() => {
    const first = actionError ? { summary: actionError, action: 'retry' as const } : rdx.capture?.humanPreviewError ? { summary: rdx.capture.humanPreviewError, action: 'copy' as const } : rdx.diagnostics[0];
    return first ? { ...first, ...compactActionError(first.summary) } : null;
  }, [actionError, rdx.capture?.humanPreviewError, rdx.diagnostics]);
  const handleDiagnostic = (item: { summary: string; action: RdxContextDiagnostic['action'] }) => {
    if (item.action === 'retry') return void openInput();
    if (item.action === 'change_device') return void document.querySelector<HTMLElement>('[data-testid="right-rail-replay-device"]')?.focus();
    if (item.action === 'settings') return void window.dispatchEvent(new Event('rdx:open-settings'));
    if (item.action === 'copy') void getElectronApi()?.appShell.copyText(item.summary);
  };
  const captureIsOpen = Boolean(rdx.capture);
  const selectedCaptureIsOpen = selectedInput?.inputId === rdx.capture?.inputId;
  return <div className="right-rail-capture-panel" aria-label="Capture controls">
    {rdx.capture ? <div className="right-rail-capture-summary" data-testid="right-rail-opened-capture"><span className="right-rail-capture-icon" aria-hidden="true"><CaptureFileGlyph /></span><strong title={rdx.capture.displayName}>{rdx.capture.displayName}</strong></div> : null}
    <div className="right-rail-capture-controls">
      <div className="right-rail-capture-input-picker">
        <span className="right-rail-capture-picker-icon" aria-hidden="true"><CaptureFileGlyph /></span>
        <DropdownSelect
          ariaLabel="Capture"
          dataTestId="right-rail-capture-input"
          options={captureOptions}
          value={selectedInputId}
          onChange={setSelectedInputId}
          placeholder="Choose capture"
          emptyLabel="No project captures"
          className="right-rail-capture-dropdown"
          triggerClassName="right-rail-capture-dropdown-trigger"
        />
      </div>
      <DropdownSelect
        ariaLabel="Replay device"
        dataTestId="right-rail-replay-device"
        options={deviceOptions}
        value={selectedDevice}
        onChange={setSelectedDevice}
        placeholder="Device"
        emptyLabel="No replay devices"
        className="right-rail-device-picker"
        triggerClassName="right-rail-device-picker-trigger"
        menuAlign="end"
      />
      <Button variant="secondary" size="sm" onClick={() => void openInput()} disabled={!scope || !selectedInput || !selectedDevice || activeAction !== null}>{activeAction === 'open' ? 'Opening...' : selectedCaptureIsOpen ? 'Reopen' : 'Open'}</Button>
    </div>
    <div className="right-rail-inline-actions">
      <Button variant="ghost" size="sm" onClick={() => void runAction('refresh', async () => {
        if (!scope) return null;
        const api = getElectronApi();
        await Promise.all([
          api?.project.inputs.refresh(scope.projectId),
          refreshDevices(),
        ]);
        return null;
      })} disabled={!scope || activeAction !== null}>{activeAction === 'refresh' ? 'Refreshing...'  : 'Refresh'}</Button>
      {captureIsOpen ? <>
        <Button variant="ghost" size="sm" onClick={() => void togglePreview()} disabled={!scope || activeAction !== null}>{activeAction === 'preview' ? 'Working...'  : rdx.capture?.humanPreviewStatus === 'open' ? 'Close preview' : 'Preview'}</Button>
      <Button variant="ghost" size="sm" onClick={copyRuntimeContext} disabled={!rdx.runtime.contextId && !rdx.runtime.replaySessionId && !rdx.capture?.replaySessionId}>Copy</Button>
      <Button variant="ghost" size="sm" onClick={() => void clearCapture()} disabled={!scope || activeAction !== null}>{activeAction === 'clear' ? 'Clearing...'  : 'Clear'}</Button>
      </> : null}
    </div>
    {diagnostic ? <div className="right-rail-diagnostic"><span>{diagnostic.summary}</span><Button variant="ghost" size="sm" onClick={() => handleDiagnostic(diagnostic)}>{diagnostic.action === 'settings' ? 'Settings' : diagnostic.action === 'change_device' ? 'Change' : diagnostic.action === 'copy' ? 'Copy' : diagnostic.actionLabel}</Button></div> : null}
  </div>;
};
