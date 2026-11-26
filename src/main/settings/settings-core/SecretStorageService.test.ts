import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isolateHome } from '../../testing/isolatedHome';

const electronMock = vi.hoisted(() => ({
  userDataRoot: '',
  encryptionAvailable: true,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => electronMock.userDataRoot,
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => electronMock.encryptionAvailable,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value: string) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buffer: Buffer) => {
      const text = buffer.toString('utf8');
      if (!text.startsWith('enc:')) throw new Error('bad payload');
      return text.slice(4);
    },
  },
}));

describe('SecretStorageService fail-closed', () => {
  let root = '';
  let previousUserData: string | undefined;
  let restoreHome: () => void = () => undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-secrets-'));
    previousUserData = process.env.RDC_AGENT_USER_DATA;
    process.env.RDC_AGENT_USER_DATA = path.join(root, 'app-data');
    restoreHome = isolateHome(root);
    electronMock.userDataRoot = process.env.RDC_AGENT_USER_DATA;
    electronMock.encryptionAvailable = true;
    fs.mkdirSync(process.env.RDC_AGENT_USER_DATA, { recursive: true });
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousUserData === undefined) delete process.env.RDC_AGENT_USER_DATA;
    else process.env.RDC_AGENT_USER_DATA = previousUserData;
    restoreHome();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('refuses to store secrets when safeStorage is unavailable', async () => {
    electronMock.encryptionAvailable = false;
    const { secretStorageService, SecretStorageUnavailableError } = await import('./SecretStorageService');
    expect(() => secretStorageService.setSecret('provider-test-api-key', 'sk-test')).toThrow(
      SecretStorageUnavailableError,
    );
  });

  it('reports a corrupt secret file on every read instead of returning an empty map', async () => {
    const { appPathService } = await import('../../runtime/AppPathService');
    const { secretStorageService } = await import('./SecretStorageService');
    const secretsPath = appPathService.getRuntimePaths().secretsPath;
    fs.mkdirSync(secretsPath, { recursive: true });
    const filePath = path.join(secretsPath, 'provider-secrets.json');
    fs.writeFileSync(filePath, '{not-json', 'utf8');

    for (let read = 0; read < 2; read += 1) {
      expect(() => secretStorageService.hasSecretRecord('provider-test-api-key')).toThrow(
        expect.objectContaining({ code: 'STORAGE_CORRUPT' }),
      );
    }
    expect(fs.readFileSync(filePath, 'utf8')).toBe('{not-json');
    expect(fs.readdirSync(secretsPath).filter((entry) => entry.includes('.corrupt-'))).toHaveLength(1);
  });

  it('reports an unreadable but intact secret file as unreadable and leaves it as it is', async () => {
    const { appPathService } = await import('../../runtime/AppPathService');
    const { secretStorageService } = await import('./SecretStorageService');
    const secretsPath = appPathService.getRuntimePaths().secretsPath;
    fs.mkdirSync(secretsPath, { recursive: true });
    const filePath = path.join(secretsPath, 'provider-secrets.json');
    fs.writeFileSync(filePath, '{}', 'utf8');
    vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
      const error = new Error('Access denied') as NodeJS.ErrnoException;
      error.code = 'EACCES';
      throw error;
    });

    expect(() => secretStorageService.hasSecretRecord('provider-test-api-key')).toThrow(
      expect.objectContaining({ code: 'STORAGE_UNREADABLE', category: 'availability' }),
    );
    expect(fs.readFileSync(filePath, 'utf8')).toBe('{}');
    expect(fs.readdirSync(secretsPath)).toEqual(['provider-secrets.json']);
  });

  it('reads the secret file and decrypts each secret once until a write replaces them', async () => {
    const { safeStorage } = await import('electron');
    const { secretStorageService } = await import('./SecretStorageService');
    secretStorageService.setSecret('provider-test-api-key', 'sk-first');
    const decrypt = vi.spyOn(safeStorage, 'decryptString');
    const reads = vi.spyOn(fs, 'readFileSync');
    for (let read = 0; read < 3; read += 1)
      expect(secretStorageService.getSecret('provider-test-api-key')).toBe('sk-first');
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(reads).not.toHaveBeenCalled();
    const revision = secretStorageService.revision;
    secretStorageService.setSecret('provider-test-api-key', 'sk-second');
    expect(secretStorageService.revision).toBeGreaterThan(revision);
    expect(secretStorageService.getSecret('provider-test-api-key')).toBe('sk-second');
  });

  it('stores and decrypts with safeStorage only', async () => {
    const { secretStorageService } = await import('./SecretStorageService');
    secretStorageService.setSecret('provider-test-api-key', 'sk-live-secret');
    expect(secretStorageService.getSecret('provider-test-api-key')).toBe('sk-live-secret');
    expect(secretStorageService.maskSecretPreview('sk-live-secret')).toBe('••••cret');
  });
});
