/**
 * Device Types - 设备管理相关类型定义
 */

export type ReplayDeviceStatus = 'offline' | 'loading' | 'connected' | 'online';

export type ReplayDeviceTransport = 'local' | 'adb_android';

export interface ReplayDeviceEntry {
  id: string;
  label: string;
  type: 'local' | 'android';
  status: ReplayDeviceStatus;
  transport: ReplayDeviceTransport;
  serial?: string;
  detailText?: string;
  lastError?: string;
  lastSeen?: number;
  remoteId?: string;
}

export interface ReplayDeviceStatusChangedPayload {
  device: ReplayDeviceEntry;
  devices: ReplayDeviceEntry[];
}
