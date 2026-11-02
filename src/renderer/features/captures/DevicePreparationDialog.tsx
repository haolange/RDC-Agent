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
  const repair = pending.result.confirmation?.kind === 'repair';
  const assessment = pending.result.confirmation?.issue?.repair;
  const target = devices.find((device) => device.id === pending.deviceId);
  const issue = pending.result.confirmation?.issue;
  const details = [
    { label: t('device.prepare.target'), value: target?.type === 'local' ? t('device.local') : target?.label ?? pending.deviceId },
    ...(target?.serial ? [{ label: t('device.prepare.serial'), value: target.serial }] : []),
    ...(issue?.actualVersion ? [{ label: t('device.prepare.installedVersion'), value: issue.actualVersion }] : []),
    ...(issue?.expectedVersion ? [{ label: t('device.prepare.requiredVersion'), value: issue.expectedVersion }] : []),
    ...(assessment ? [
      { label: t('device.prepare.package'), value: assessment.packageName },
      { label: t('device.prepare.repairActions'), value: assessment.actions.map((action) => t(action === 'restart_helper'
        ? 'device.prepare.restartHelper' : action === 'downgrade_helper' ? 'device.prepare.downgradeHelper' : 'device.prepare.reinstallHelper')).join(', ') },
    ] : []),
  ];
  return <ConfirmationDialog title={t(repair ? 'device.prepare.confirmRepairTitle' : 'device.prepare.confirmCloseTitle')}
    message={t(repair ? 'device.prepare.confirmRepairMessage' : 'device.prepare.confirmCloseMessage')}
    confirmLabel={t(repair ? 'device.prepare.confirmRepair' : 'device.prepare.confirmClose')}
    cancelLabel={t('device.prepare.keepCurrent')} details={details} busy={confirming}
    onConfirm={confirm} onCancel={dismiss} />;
}
