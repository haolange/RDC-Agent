/**
 * Device Types - 设备管理相关类型定义
 */

export type ReplayDeviceStatus = 'offline' | 'loading' | 'connected' | 'online';

export type ReplayDeviceTransport = 'local' | 'adb_android';

export interface AndroidBootstrapMetadata {
  packageName?: string;
  activityName?: string;
  abi?: string;
  apkPath?: string;
  host?: string;
  port?: number;
  remotePort?: number;
  forwardSpec?: string;
  configRemotePath?: string;
  cleanupActions?: string[];
  installedApk?: boolean;
  pushedConfig?: boolean;
  startedActivity?: boolean;
  createdForward?: boolean;
  installMode?: 'upgrade' | 'force_replace';
  installReason?: 'fresh_install' | 'mismatched_existing_apk' | 'version_downgrade' | 'signature_mismatch';
  uninstalledExisting?: boolean;
}

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
  bootstrap?: AndroidBootstrapMetadata;
  activationPhase?: 'idle' | 'connect' | 'ready';
  activationErrorCode?: string;
  activationErrorMessage?: string;
  activationUpdatedAt?: number;
}

export interface ReplayDeviceStatusChangedPayload {
  device: ReplayDeviceEntry;
  devices: ReplayDeviceEntry[];
}
