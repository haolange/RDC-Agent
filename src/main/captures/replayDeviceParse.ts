import type {
  AndroidBootstrapMetadata,
  ReplayDeviceEntry,
  ReplayDeviceTransport,
} from '@shared/types/device';

export interface DeviceResumeCacheRecord {
  deviceId: string;
  serial: string;
  label: string;
  transport: ReplayDeviceTransport;
  bootstrap?: AndroidBootstrapMetadata;
  lastValidatedAt: number;
}

export interface DeviceResumeCachePayload {
  lastDevice?: DeviceResumeCacheRecord;
}

export function sanitizeDeviceId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function parseAndroidBootstrapMetadata(payload: unknown): AndroidBootstrapMetadata | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const cleanupActions = Array.isArray(record.cleanup_actions)
    ? record.cleanup_actions.filter((item): item is string => typeof item === 'string')
    : undefined;

  const metadata: AndroidBootstrapMetadata = {
    packageName: normalizeString(record.package_name),
    activityName: normalizeString(record.activity_name),
    abi: normalizeString(record.abi),
    apkPath: normalizeString(record.apk_path),
    host: normalizeString(record.host),
    port: normalizeNumber(record.port),
    remotePort: normalizeNumber(record.remote_port),
    forwardSpec: normalizeString(record.forward_spec),
    configRemotePath: normalizeString(record.config_remote_path),
    cleanupActions,
    installedApk: normalizeBoolean(record.installed_apk),
    pushedConfig: normalizeBoolean(record.pushed_config),
    startedActivity: normalizeBoolean(record.started_activity),
    createdForward: normalizeBoolean(record.created_forward),
    installMode: record.install_mode === 'upgrade' || record.install_mode === 'force_replace'
      ? record.install_mode
      : undefined,
    installReason:
      record.install_reason === 'fresh_install'
      || record.install_reason === 'mismatched_existing_apk'
      || record.install_reason === 'version_downgrade'
      || record.install_reason === 'signature_mismatch'
        ? record.install_reason
        : undefined,
    uninstalledExisting: normalizeBoolean(record.uninstalled_existing),
  };

  return Object.values(metadata).some((value) => value !== undefined) ? metadata : undefined;
}

export function parsePersistedAndroidBootstrapMetadata(payload: unknown): AndroidBootstrapMetadata | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const cleanupActions = Array.isArray(record.cleanupActions)
    ? record.cleanupActions.filter((item): item is string => typeof item === 'string')
    : undefined;

  const metadata: AndroidBootstrapMetadata = {
    packageName: normalizeString(record.packageName),
    activityName: normalizeString(record.activityName),
    abi: normalizeString(record.abi),
    apkPath: normalizeString(record.apkPath),
    host: normalizeString(record.host),
    port: normalizeNumber(record.port),
    remotePort: normalizeNumber(record.remotePort),
    forwardSpec: normalizeString(record.forwardSpec),
    configRemotePath: normalizeString(record.configRemotePath),
    cleanupActions,
    installedApk: normalizeBoolean(record.installedApk),
    pushedConfig: normalizeBoolean(record.pushedConfig),
    startedActivity: normalizeBoolean(record.startedActivity),
    createdForward: normalizeBoolean(record.createdForward),
    installMode: record.installMode === 'upgrade' || record.installMode === 'force_replace'
      ? record.installMode
      : undefined,
    installReason:
      record.installReason === 'fresh_install'
      || record.installReason === 'mismatched_existing_apk'
      || record.installReason === 'version_downgrade'
      || record.installReason === 'signature_mismatch'
        ? record.installReason
        : undefined,
    uninstalledExisting: normalizeBoolean(record.uninstalledExisting),
  };

  return Object.values(metadata).some((value) => value !== undefined) ? metadata : undefined;
}

export function parseResumeCacheRecord(payload: unknown): DeviceResumeCacheRecord | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const deviceId = normalizeString(record.deviceId);
  const serial = normalizeString(record.serial);
  const label = normalizeString(record.label);
  const transport = record.transport === 'local' || record.transport === 'adb_android'
    ? record.transport
    : undefined;
  const lastValidatedAt = normalizeNumber(record.lastValidatedAt);

  if (!deviceId || !serial || !label || !transport || !lastValidatedAt) {
    return null;
  }

  return {
    deviceId,
    serial,
    label,
    transport,
    lastValidatedAt,
    bootstrap: parsePersistedAndroidBootstrapMetadata(record.bootstrap),
  };
}

export function hasBootstrapManagedLaunch(bootstrap?: AndroidBootstrapMetadata): boolean {
  return bootstrap?.startedActivity === true;
}

export function buildBootstrapDetailText(bootstrap?: AndroidBootstrapMetadata): string[] {
  if (!bootstrap) {
    return [];
  }

  const suffix: string[] = [];
  if (bootstrap.installMode === 'force_replace') {
    suffix.push('APK force replaced');
  } else if (bootstrap.installedApk && bootstrap.installReason === 'fresh_install') {
    suffix.push('APK installed');
  } else if (bootstrap.installedApk) {
    suffix.push('APK upgraded');

  }

  if (bootstrap.abi) {
    suffix.push(bootstrap.abi);
  }
  if (bootstrap.forwardSpec) {
    suffix.push(bootstrap.forwardSpec);
  }

  return suffix;
}

export function buildRemoteReadyText(bootstrap?: AndroidBootstrapMetadata): string {
  const prefix = hasBootstrapManagedLaunch(bootstrap)
    ? 'Started Android RenderDoc and connected'
    : 'Connected to Android RenderDoc server';
  const suffix = buildBootstrapDetailText(bootstrap);
  return suffix.length > 0 ? `${prefix} · ${suffix.join(' · ')}` : prefix;
}

export function applyActivationFailure(
  device: ReplayDeviceEntry,
  phase: ReplayDeviceEntry['activationPhase'],
  message: string,
  code?: string,
): ReplayDeviceEntry {
  return {
    ...device,
    status: 'offline',
    detailText: message,
    lastError: message,
    remoteId: undefined,
    activationPhase: phase,
    activationErrorCode: code,
    activationErrorMessage: message,
    activationUpdatedAt: Date.now(),
  };
}

export function parseAdbDeviceLine(line: string): ReplayDeviceEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('List of devices attached')) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return null;
  }

  const serial = parts[0];
  const adbState = parts[1];
  const metadata = new Map<string, string>();
  for (const token of parts.slice(2)) {
    const separatorIndex = token.indexOf(':');
    if (separatorIndex > 0) {
      metadata.set(token.slice(0, separatorIndex), token.slice(separatorIndex + 1));
    }
  }

  const model = metadata.get('model');
  const deviceName = metadata.get('device');
  const transportId = metadata.get('transport_id');
  const label = model ?? deviceName ?? serial;

  let detailText = 'Ready to connect to Android RenderDoc server';
  let lastError: string | undefined;
  let status: ReplayDeviceEntry['status'] = 'offline';

  if (adbState === 'device') {
    status = 'offline';
  } else if (adbState === 'offline') {
    detailText = 'ADB reports this device as offline.';
    lastError = detailText;
  } else if (adbState === 'unauthorized') {
    detailText = 'ADB authorization required on the device.';
    lastError = detailText;
  } else {
    detailText = `ADB state: ${adbState}`;
    lastError = detailText;
  }

  if (transportId) {
    detailText = `${detailText}${detailText.endsWith('.') ? '' : '.'} transport ${transportId}`;
  }

  return {
    id: `android-${sanitizeDeviceId(serial)}`,
    label,
    serial,
    type: 'android',
    status,
    transport: 'adb_android',
    detailText,
    lastError,
    lastSeen: Date.now(),
  };
}

export function readActionString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function parseRemoteBootstrap(data: Record<string, unknown>): AndroidBootstrapMetadata | undefined {
  const direct = parseAndroidBootstrapMetadata(data.bootstrap);
  if (direct) {
    return direct;
  }

  const detail = data.detail;
  if (!detail || typeof detail !== 'object') {
    return undefined;
  }

  return parseAndroidBootstrapMetadata((detail as Record<string, unknown>).bootstrap);
}
