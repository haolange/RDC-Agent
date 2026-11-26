import { useMemo, useState } from 'react';
import { formatBytes } from '../../lib/formatBytes';
import { useDeviceStore } from '../../stores/deviceStore';
import { useSessionDeviceStore } from '../../stores/sessionDeviceStore';
import {
  DevicePreparationStatus,
  isDevicePreparing,
  isDeviceInstallationUnconfirmed,
} from '../../patterns/DevicePreparationStatus';
import { CopyDiagnosticsButton } from '../../patterns/CopyDiagnostics';
import { Button } from '../../ui/Button';
import { Select } from '../../ui/Select';
import { Icon } from '../../ui/Icon';
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
import { useCaptureActions, type CaptureAction } from './useCaptureActions';
import { CaptureRecoveryCallout } from './CaptureRecoveryCallout';
import type { CaptureScope } from './capturePanelActions';
import type { RdcContextPanelViewModel, TaskContextPanelViewModel } from '@shared/types/trace';
import './CaptureReplay.css';

function ScopedCapturePanel({ scope, capture }: { scope: CaptureScope; capture: RdcContextPanelViewModel }) {
  const { t, language } = useI18n();
  const { state, selection, error: connectionError, actionFailure, reload, receive } = useCaptureReplay(scope);
  const recovery = useCaptureRecovery(scope, state?.revision);
  const devices = useDeviceStore((value) => value.devices);
  const [draft, setDraft] = useState<{ inputId: string } | null>(null);
  const { action, error, run: runAction, refreshProjection } = useCaptureActions(scope, reload, receive);
  const [restoring, setRestoring] = useState(false);
  const actualInputId = state?.inputId ?? selection?.inputId ?? capture.availableCaptures[0]?.inputId ?? '';
  const actualDeviceId = state?.replayDeviceId ?? 'local';
  const targetDeviceId = state?.preparation.targetDeviceId ?? actualDeviceId;
  const chosen = draft ?? { inputId: actualInputId };
  const selectedInput =
    capture.availableCaptures.find((input) => input.inputId === chosen.inputId) ?? capture.availableCaptures[0];
  const open = Boolean(state?.inputId && state.contextId);
  const pending = open && chosen.inputId !== actualInputId;
  const phaseBusy = Boolean(
    state && ['validating', 'connecting', 'transferring', 'opening', 'loading_image', 'closing'].includes(state.phase),
  );
  const locked = Boolean(state?.interactionLock);
  const preparing = state ? isDevicePreparing(state.preparation.phase) : false;
  const installUnconfirmed = isDeviceInstallationUnconfirmed(state?.preparation);
  const disabled = locked || installUnconfirmed || phaseBusy || preparing || restoring || action !== null || !state;
  const deviceDisabled =
    locked || installUnconfirmed || (!preparing && phaseBusy) || restoring || action !== null || !state;
  const deviceReady = targetDeviceId === 'local' || state?.preparation.phase === 'ready';
  const partial = isCapturePartialReady(state);
  const run = async (operation: CaptureAction) => {
    if (disabled) return;
    await runAction(operation, state, selectedInput, targetDeviceId, () => setDraft(null));
  };
  const statusTone = resolveCaptureStatusTone({ phase: state?.phase, pending, partial });
  const callouts = collectCaptureCallouts({
    failureTitle: t('control.replay.actionFailed'),
    actionFailureTitles: {
      open: t('control.replay.openFailed'),
      close: t('control.replay.closeFailed'),
      refresh: t('control.replay.refreshFailed'),
      image: t('control.replay.exportFailed'),
    },
    warning: state?.warning ?? null,
    finalPresentTitle: t('control.replay.finalPresentUnavailable'),
    actionError: state?.preparation.issue ? null : error,
    connectionError,
    stateError: state?.preparation.issue ? null : (state?.error ?? null),
    factLabels: {
      no_color_output: t(FACT_LABELS.no_color_output),
      missing_target: t(FACT_LABELS.missing_target),
      export_failure: t(FACT_LABELS.export_failure),
    },
  });
  const deviceLabel = (deviceId: string) =>
    deviceId === 'local'
      ? t('device.local')
      : (devices.find((device) => device.id === deviceId)?.label ?? t('control.replay.unknownDevice'));
  const originalRecovery = recovery.status?.original;
  const showRecoveryTarget =
    originalRecovery &&
    (originalRecovery.inputId !== selectedInput?.inputId || originalRecovery.deviceId !== targetDeviceId);

  // The rail tab already names this panel; the status chip leads instead of a second title.
  return (
    <div className="capture-replay-panel" aria-label={t('control.rightRail.capture.controls')}>
      <div className="capture-replay-status-row">
        <CaptureReplayStatusChip
          label={t(captureStatusLabelKey({ pending, partial, phase: state?.phase }))}
          tone={statusTone}
        />
        <CopyDiagnosticsButton
          className="capture-replay-copy-diagnostics"
          testId="capture-replay-copy-diagnostics"
          facts={[
            { label: t('control.replay.contextId'), value: state?.contextId },
            { label: t('control.replay.deviceId'), value: actualDeviceId },
            { label: t('control.replay.inputPath'), value: selectedInput?.filePath },
          ]}
        />
      </div>
      <div className="capture-replay-file-row">
        <Select
          dataTestId="right-rail-capture-input"
          ariaLabel={t('control.rightRail.capture.title')}
          value={selectedInput?.inputId ?? ''}
          tooltip={
            selectedInput ? `${selectedInput.fileName} · ${formatBytes(selectedInput.sizeBytes, language)}` : undefined
          }
          options={capture.availableCaptures.map((input) => ({ value: input.inputId, label: input.fileName }))}
          disabled={disabled}
          onChange={(inputId) => setDraft({ ...chosen, inputId })}
        />
      </div>
      <div className="capture-replay-device-row">
        <Select
          dataTestId="right-rail-replay-device"
          ariaLabel={t('control.sessionContextDevice')}
          value={targetDeviceId}
          disabled={deviceDisabled}
          options={[
            ...devices.map((device) => ({
              value: device.id,
              label: device.type === 'local' ? t('device.local') : device.label,
              disabled: device.type === 'android' && device.adbState !== 'device',
            })),
            ...(devices.some((device) => device.id === targetDeviceId)
              ? []
              : [{ value: targetDeviceId, label: deviceLabel(targetDeviceId), disabled: true }]),
          ]}
          onChange={(deviceId) => {
            void useSessionDeviceStore.getState().prepare(scope, deviceId);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('control.replay.refresh')}
          aria-busy={action === 'refresh'}
          disabled={disabled}
          onClick={() => void run('refresh')}
        >
          <Icon name="refresh" />
        </Button>
        <Button
          variant={open ? 'secondary' : 'primary'}
          size="sm"
          disabled={disabled || !selectedInput || (!open && !deviceReady)}
          onClick={() => void run(pending || !open ? 'open' : 'close')}
        >
          {t(pending ? 'control.replay.switch' : open ? 'control.replay.close' : 'control.captureOpen')}
        </Button>
      </div>
      {pending && (
        <div className="capture-replay-pending">
          <small>
            {capture.availableCaptures.find((input) => input.inputId === actualInputId)?.fileName} ·{' '}
            {deviceLabel(actualDeviceId)}
          </small>
          <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setDraft(null)}>
            {t('control.replay.cancel')}
          </Button>
        </div>
      )}
      <CaptureRecoveryCallout
        status={recovery.status}
        error={recovery.error}
        locked={locked}
        disabled={disabled}
        restoring={restoring}
        showTarget={Boolean(showRecoveryTarget)}
        deviceLabel={deviceLabel}
        onRestore={() => {
          if (!state) return;
          setRestoring(true);
          void recovery
            .restore(state.generation)
            .then(async (next) => {
              if (next) {
                receive(next);
                await refreshProjection();
              }
            })
            .finally(() => setRestoring(false));
        }}
      />
      <DevicePreparationStatus
        preparation={state?.preparation ?? null}
        issue={actionFailure?.issue}
        hasCapture={open}
        disabled={locked}
        onRetry={() => {
          void useSessionDeviceStore
            .getState()
            .prepare(scope, installUnconfirmed ? targetDeviceId : (actionFailure?.deviceId ?? targetDeviceId));
        }}
        onCancel={() => useSessionDeviceStore.getState().cancel(scope)}
      />
      <CaptureReplayCallouts
        callouts={callouts}
        disabled={disabled}
        refreshDisabled={state ? disabled : action !== null}
        retryLabels={{
          open: t('control.replay.retryOpen'),
          close: t('control.replay.retryClose'),
          image: t('control.replay.retryImage'),
          refresh: t('control.replay.refresh'),
        }}
        onRetry={(operation) => void (operation === 'refresh' && !state ? reload() : run(operation))}
      />
      <CaptureWorkspace
        scope={scope}
        state={state}
        disabled={disabled || !open || pending || state.error?.retry === 'close'}
        receive={receive}
      />
    </div>
  );
}

export function CapturePanel({
  task,
  capture,
}: {
  task: TaskContextPanelViewModel;
  capture: RdcContextPanelViewModel;
}) {
  const { t } = useI18n();
  const scope = useMemo(
    () => (task.projectId && task.sessionId ? { projectId: task.projectId, sessionId: task.sessionId } : null),
    [task.projectId, task.sessionId],
  );
  return scope ? (
    <ScopedCapturePanel key={`${scope.projectId}:${scope.sessionId}`} scope={scope} capture={capture} />
  ) : (
    <span>{t('control.replay.noSession')}</span>
  );
}
