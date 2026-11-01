import React from 'react';
import type { ReplayDeviceEntry } from '@shared/types/device';
import type { TranslationKey } from '../../../i18n';

export const DROPDOWN_MIN_WIDTH = 280;
export const VIEWPORT_MARGIN = 16;
export const ANCHOR_GAP = 8;

export type DropdownPlacement = 'above' | 'below';

export const clamp = (value: number, min: number, max: number): number => {
  if (max < min) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
};

export const DeviceTypeIcon: React.FC<{ type: ReplayDeviceEntry['type'] }> = ({ type }) => {
  if (type === 'local') {
    return (
      <svg className="device-type-icon" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V3a2 2 0 0 0-2-2H8zm0 1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z" />
        <path d="M3 5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-2H9v1H4V7h1V5H3z" />
      </svg>
    );
  }

  return (
    <svg className="device-type-icon" viewBox="0 0 16 16" fill="currentColor">
      <rect x="4" y="1.5" width="8" height="13" rx="1.5" />
      <rect x="6" y="3.25" width="4" height="8" rx="0.75" fill="var(--token-bg-shell)" />
    </svg>
  );
};

export const STATUS_TEXT_KEYS: Record<ReplayDeviceEntry['status'], TranslationKey> = {
  offline: 'device.status.offline',
  loading: 'device.status.loading',
  connected: 'device.status.connected',
  online: 'device.status.online',
};

export function getDeviceStatusKey(device: ReplayDeviceEntry): TranslationKey {
  if (device.status === 'connected' || device.status === 'loading') return STATUS_TEXT_KEYS[device.status];
  if (device.type === 'android') {
    if (device.adbState === 'unauthorized') return 'device.status.unauthorized';
    if (device.adbState === 'missing' || device.adbState === 'offline') return 'device.status.offline';
    if (device.adbState === 'device' && device.status === 'offline') return 'device.status.disconnected';
  }
  return STATUS_TEXT_KEYS[device.status];
}

export function getBootstrapSummary(
  device: ReplayDeviceEntry,
  t: (key: TranslationKey) => string,
): string | null {
  if (device.type !== 'android' || !device.bootstrap) {
    return null;
  }

  const summary: string[] = [];
  if (device.bootstrap.packageName) {
    summary.push(device.bootstrap.packageName);
  }
  if (device.bootstrap.installMode === 'force_replace') {
    summary.push(t('device.apkForceReplaced'));
  } else if (device.bootstrap.installedApk) {
    summary.push(t('device.apkInstalled'));
  } else if (device.bootstrap.packageName) {
    summary.push(t('device.apkVerified'));
  }
  if (device.bootstrap.abi) {
    summary.push(device.bootstrap.abi);
  }

  return summary.length > 0 ? summary.join(' · ') : null;
}
