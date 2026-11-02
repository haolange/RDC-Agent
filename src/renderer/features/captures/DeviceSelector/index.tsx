import { useEffect, useMemo, useRef, useState } from 'react';
import { useDeviceStore } from '../../../stores/deviceStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useSessionDeviceStore } from '../../../stores/sessionDeviceStore';
import { useSessionDevicePreparation } from '../../../hooks/useSessionDevicePreparation';
import { DevicePreparationStatus, isDeviceInstallationUnconfirmed } from '../../../patterns/DevicePreparationStatus';
import { useI18n } from '../../../i18n';
import { Button } from '../../../ui/Button';
import { Popover } from '../../../ui/Popover';
import { DeviceTypeIcon } from './DeviceSelectorParts';
import { DevicePreparationDialog } from '../DevicePreparationDialog';
import './DeviceSelector.css';
import './DeviceDiscovery.css';

export function DeviceSelector() {
  const { t } = useI18n();
  const { devices, discovery, refreshDevices, startDeviceWatch, stopDeviceWatch } = useDeviceStore();
  const project = useProjectStore((state) => state.currentProject);
  const session = useProjectStore((state) => state.currentSession);
  const scope = useMemo(() => project && session ? { projectId: project.projectId, sessionId: session.sessionId } : null, [project, session]);
  const { state, error, actionFailure } = useSessionDevicePreparation(scope);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const targetId = state?.preparation.targetDeviceId ?? state?.replayDeviceId ?? 'local';
  const selected = devices.find((device) => device.id === targetId);
  const name = targetId === 'local' ? t('device.local') : selected?.label ?? targetId;
  const locked = Boolean(state?.interactionLock);
  const installUnconfirmed = isDeviceInstallationUnconfirmed(state?.preparation);
  useEffect(() => {
    if (!open) return;
    void startDeviceWatch();
    const frame = requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]:not(:disabled), [role="option"]:not(:disabled)')?.focus());
    return () => { cancelAnimationFrame(frame); void stopDeviceWatch(); };
  }, [open, startDeviceWatch, stopDeviceWatch]);
  const select = (deviceId: string) => {
    if (!scope || !state || locked || (installUnconfirmed && deviceId !== targetId)) return;
    void useSessionDeviceStore.getState().prepare(scope, deviceId);
  };
  const discoveryMessage = discovery.status === 'failed' ? t('device.discovery.failed')
    : discovery.status === 'scanning' || discovery.status === 'idle' ? t('device.discovery.scanning')
    : devices.some(device => device.type === 'android' && device.adbState !== 'missing') ? null : t('device.discovery.empty');
  return <div className="device-selector-container">
    <Popover open={open} onOpenChange={setOpen} align="end" className="device-selector-dropdown"
      trigger={<Button variant="ghost" size="sm" className="device-selector-trigger device-selector-trigger-utility main-utility-toggle"
        data-testid="utility-device-selector-trigger" aria-haspopup="dialog" title={t('device.sessionDeviceTitle', { summary: name })}>
        <DeviceTypeIcon type={targetId === 'local' ? 'local' : 'android'} />
        <span className="device-selector-utility-label">{t('device.sessionDeviceShort', { summary: name })}</span>
      </Button>}>
      <div data-testid="utility-device-selector-dropdown" aria-label={t('device.discovery.title')}>
        {!scope && <p className="device-selector-session-note">{t('device.prepare.noSession')}</p>}
        <div ref={menuRef} role="listbox" aria-label={t('device.discovery.title')} onKeyDown={(event) => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="option"]:not(:disabled)'));
          if (!options.length) return;
          const current = options.indexOf(document.activeElement as HTMLButtonElement);
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (current + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
          event.preventDefault(); options[index]?.focus({ preventScroll: true });
        }}>
          {devices.map((device) => <Button key={device.id} variant="ghost" size="sm" role="option"
            className={`device-selector-option ${device.id === targetId ? 'is-selected' : ''}`} aria-selected={device.id === targetId}
            disabled={!scope || !state || locked || installUnconfirmed || (device.type === 'android' && device.adbState !== 'device')}
            onClick={() => select(device.id)} title={[device.type === 'local' ? t('device.local') : device.label, device.serial].filter(Boolean).join('\n')}>
            <span className="device-selector-option-main"><span className="device-option-leading"><DeviceTypeIcon type={device.type} />
              <span className="device-option-name">{device.type === 'local' ? t('device.local') : device.label}</span></span>
              <span className={`device-option-status${device.type === 'android' && device.adbState !== 'device' ? ' is-error' : ''}`}>{t(device.type === 'local' ? 'device.ready' : device.adbState === 'device' ? 'device.discovery.available' : device.adbState === 'unauthorized' ? 'device.status.unauthorized' : 'device.status.offline')}</span>
            </span>
          </Button>)}
        </div>
        {scope && <DevicePreparationStatus preparation={state?.preparation ?? null} issue={actionFailure?.issue} transportError={error} hasCapture={Boolean(state?.inputId && state.contextId)} disabled={locked}
          onRetry={() => select(installUnconfirmed ? targetId : actionFailure?.deviceId ?? targetId)} onCancel={() => useSessionDeviceStore.getState().cancel(scope)} />}
        <div className="device-discovery-footer">
          {discoveryMessage && <span role="status" className={`device-discovery-status ${discovery.status === 'failed' ? 'is-error' : ''}`}>{discoveryMessage}</span>}
          <Button variant="ghost" size="sm" disabled={discovery.status === 'scanning'} onClick={() => { void refreshDevices(); }}>{t('device.discovery.refresh')}</Button>
        </div>
      </div>
    </Popover>
    <DevicePreparationDialog />
  </div>;
}
export default DeviceSelector;
