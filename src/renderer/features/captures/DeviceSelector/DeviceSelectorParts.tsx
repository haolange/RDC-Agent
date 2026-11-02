import type { ReplayDeviceEntry } from '@shared/types/device';
export function DeviceTypeIcon({ type }: { type: ReplayDeviceEntry['type'] }) {
  return <svg className="device-type-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    {type === 'local' ? <path d="M2 2h12v9H9v2h3v1H4v-1h3v-2H2V2zm1 1v7h10V3H3z" />
      : <path d="M5 1h6a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zm0 2v9h6V3H5z" />}
  </svg>;
}
