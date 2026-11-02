/**
 * Device Types - 设备管理相关类型定义
 */

export type ReplayDeviceStatus = 'offline' | 'online';

export type ReplayDeviceTransport = 'local' | 'adb_android';

export type DevicePreparationPhase = 'idle' | 'checking' | 'installing' | 'starting' | 'verifying' | 'ready' | 'needs_action' | 'failed' | 'cancelled';
export interface RemoteRepairAssessment {
  fingerprint: string;
  actions: Array<'restart_helper' | 'reinstall_helper' | 'downgrade_helper'>;
  packageName: string;
  deviceSerial: string;
  apkSha256: string;
  installedIdentity: string;
  serviceIdentity: string[];
}
/** Product copy is derived from code; diagnostic remains the original native report. */
export interface ReplayDeviceIssue {
  code: string;
  stage: DevicePreparationPhase;
  diagnostic: string;
  recovery: 'retry' | 'repair' | 'configure_tools' | 'verify_installation' | null;
  expectedVersion?: string;
  actualVersion?: string;
  repair?: RemoteRepairAssessment;
  deviceAction?: { kind: 'package_install'; outcome: 'unconfirmed'; uninstalledExisting: boolean };
}
export interface SessionDevicePreparation {
  targetDeviceId: string | null;
  phase: DevicePreparationPhase;
  issue: ReplayDeviceIssue | null;
  installation?: RemoteInstallationReceipt;
}
/** A completed native installation is not rolled back by cancelling connection. */
export interface RemoteInstallationReceipt {
  installedApk: boolean;
  uninstalledExisting: boolean;
  installMode: AndroidBootstrapMetadata['installMode'];
}

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
  installMode?: 'existing' | 'install' | 'update' | 'force_replace';
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
  adbState?: 'device' | 'unauthorized' | 'offline' | 'missing' | 'unknown';
  lastSeen?: number;
}

export interface ReplayDeviceSnapshot {
  revision: number;
  devices: ReplayDeviceEntry[];
  discovery: { status: 'idle' | 'scanning' | 'ready' | 'failed'; error?: string };
}

export type ReplayDeviceStatusChangedPayload = ReplayDeviceSnapshot;
