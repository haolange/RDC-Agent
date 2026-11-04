import { useI18n } from '../../i18n';
import { useDeviceStore } from '../../stores/deviceStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionDeviceStore } from '../../stores/sessionDeviceStore';
import { ConfirmationDialog } from '../../ui/ConfirmationDialog';

export function DevicePreparationDialog() {
  const { t } = useI18n();
  const pending = useSessionDeviceStore((state) => state.confirmation);
  const confirming = useSessionDeviceStore((state) => state.confirming);
  const confirm = useSessionDeviceStore((state) => state.confirm);
  const dismiss = useSessionDeviceStore((state) => state.dismissConfirmation);
  const currentSessionId = useProjectStore((state) => state.currentSession?.sessionId);
  const devices = useDeviceStore((state) => state.devices);
  if (!pending || pending.scope.sessionId !== currentSessionId) return null;
  const target = devices.find((device) => device.id === pending.deviceId);
  const details = [
    { label: t('device.prepare.target'), value: target?.type === 'local' ? t('device.local') : target?.label ?? pending.deviceId },
    ...(target?.serial ? [{ label: t('device.prepare.serial'), value: target.serial }] : []),
  ];
  return <ConfirmationDialog title={t('device.prepare.confirmCloseTitle')}
    message={t('device.prepare.confirmCloseMessage')}
    confirmLabel={t('device.prepare.confirmClose')}
    cancelLabel={t('device.prepare.keepCurrent')} details={details} busy={confirming}
    onConfirm={confirm} onCancel={dismiss} />;
}
