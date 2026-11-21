import { Icon } from '../../../ui/Icon';
import type { ReplayDeviceEntry } from '@shared/types/device';
export function DeviceTypeIcon({ type }: { type: ReplayDeviceEntry['type'] }) {
  return <Icon name={type === 'local' ? 'device-desktop' : 'device-phone'} className="device-type-icon" />;
}
