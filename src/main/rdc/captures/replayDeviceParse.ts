import type {
  AndroidBootstrapMetadata,
  ReplayDeviceEntry,
} from '@shared/types/device';

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
    installMode: ['existing', 'install', 'update', 'force_replace'].includes(String(record.install_mode))
      ? record.install_mode as AndroidBootstrapMetadata['installMode']
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
  const label = model ?? deviceName ?? serial;

  const status: ReplayDeviceEntry['status'] = adbState === 'device' ? 'online' : 'offline';

  return {
    id: `android-${sanitizeDeviceId(serial)}`,
    label,
    serial,
    adbState: adbState === 'device' || adbState === 'unauthorized' || adbState === 'offline' ? adbState : 'unknown',
    type: 'android',
    status,
    transport: 'adb_android',
    lastSeen: Date.now(),
  };
}

export function parseRemoteBootstrap(data: Record<string, unknown>): AndroidBootstrapMetadata | undefined {
  const serverInfo = data.server_info;
  if (!serverInfo || typeof serverInfo !== 'object' || Array.isArray(serverInfo)) {
    return undefined;
  }
  return parseAndroidBootstrapMetadata((serverInfo as Record<string, unknown>).bootstrap);
}
