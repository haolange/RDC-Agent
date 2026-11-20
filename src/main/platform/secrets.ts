/**
 * Credential storage policy per host. Encrypted storage is accepted only when
 * the OS really protects the key: on Linux, Electron falls back to the
 * `basic_text` backend (a hard-coded key) when no keyring is reachable, which
 * is treated as unavailable so credential writes fail closed.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { currentHost, type HostDescriptor } from './host';
import type { SafeStorage } from 'electron';

export type SecretStorageProbe = Pick<SafeStorage, 'isEncryptionAvailable' | 'getSelectedStorageBackend'>;

/** Null when encrypted credential storage may be used, otherwise the reason it may not. */
export function secretStorageUnavailableReason(
  storage: SecretStorageProbe,
  host: HostDescriptor = currentHost(),
): string | null {
  if (!storage.isEncryptionAvailable()) return 'OS safeStorage is unavailable; refusing to store credentials.';
  if (!host.isLinux) return null;
  const backend = storage.getSelectedStorageBackend();
  if (backend === 'basic_text') {
    return 'No OS keyring is available to safeStorage (backend basic_text). '
      + 'Install and unlock a Secret Service keyring such as GNOME Keyring or KWallet, then restart; refusing to store credentials.';
  }
  if (backend === 'unknown') return 'safeStorage has not selected an OS keyring yet; refusing to store credentials.';
  return null;
}

/** Restricts a credential file to the current user: mode 0600, plus an ACL on Windows. */
export function hardenSecretFile(filePath: string, host: HostDescriptor = currentHost()): void {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows may ignore POSIX mode bits; ACL hardening is best-effort below.
  }
  if (host.isWindows) {
    try {
      spawnSync('icacls', [filePath, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {
      // Best-effort Windows ACL.
    }
  }
}
