import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { currentHost, describeHost } from './host';
import { hardenSecretFile, secretStorageUnavailableReason, type SecretStorageProbe } from './secrets';

const windows = describeHost('win32', 'x64');
const linux = describeHost('linux', 'x64');
const storage = (
  available: boolean,
  backend: ReturnType<SecretStorageProbe['getSelectedStorageBackend']>,
): SecretStorageProbe => ({
  isEncryptionAvailable: () => available,
  getSelectedStorageBackend: () => backend,
});

describe('secret storage policy', () => {
  it('fails closed when encryption is unavailable on any host', () => {
    expect(secretStorageUnavailableReason(storage(false, 'gnome_libsecret'), windows)).toMatch(/unavailable/);
    expect(secretStorageUnavailableReason(storage(false, 'gnome_libsecret'), linux)).toMatch(/unavailable/);
  });

  it('rejects the Linux basic_text backend and an unselected backend, and accepts a keyring', () => {
    expect(secretStorageUnavailableReason(storage(true, 'basic_text'), linux)).toMatch(/basic_text.*keyring/);
    expect(secretStorageUnavailableReason(storage(true, 'unknown'), linux)).toMatch(/not selected/);
    expect(secretStorageUnavailableReason(storage(true, 'kwallet6'), linux)).toBeNull();
  });

  it('keeps Windows on the encryption availability check alone', () => {
    expect(secretStorageUnavailableReason(storage(true, 'basic_text'), windows)).toBeNull();
  });
});

describe('secret file hardening', () => {
  it('restricts POSIX mode bits to the owner', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-secret-mode-'));
    try {
      const file = path.join(root, 'provider-secrets.json');
      fs.writeFileSync(file, '{}', { mode: 0o644 });
      hardenSecretFile(file, linux);
      if (!currentHost().isWindows) {
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
