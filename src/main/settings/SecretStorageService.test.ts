import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  let previousHome: string | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-secrets-'));
    previousUserData = process.env.RDC_AGENT_USER_DATA;
    previousHome = process.env.RDC_AGENT_HOME;
    process.env.RDC_AGENT_USER_DATA = path.join(root, 'app-data');
    process.env.RDC_AGENT_HOME = path.join(root, '.rdc-agent');
    electronMock.userDataRoot = process.env.RDC_AGENT_USER_DATA;
    electronMock.encryptionAvailable = true;
    fs.mkdirSync(process.env.RDC_AGENT_USER_DATA, { recursive: true });
    vi.resetModules();
  });

  afterEach(() => {
    if (previousUserData === undefined) delete process.env.RDC_AGENT_USER_DATA;
    else process.env.RDC_AGENT_USER_DATA = previousUserData;
    if (previousHome === undefined) delete process.env.RDC_AGENT_HOME;
    else process.env.RDC_AGENT_HOME = previousHome;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('refuses to store secrets when safeStorage is unavailable', async () => {
    electronMock.encryptionAvailable = false;
    const { secretStorageService, SecretStorageUnavailableError } = await import('./SecretStorageService');
    expect(() => secretStorageService.setSecret('provider-test-api-key', 'sk-test')).toThrow(
      SecretStorageUnavailableError,
    );
  });

  it('quarantines corrupt secret files instead of returning an empty map', async () => {
    const { appPathService } = await import('../runtime/AppPathService');
    const { secretStorageService, SecretStoreCorruptError } = await import('./SecretStorageService');
    const secretsPath = appPathService.getRuntimePaths().secretsPath;
    fs.mkdirSync(secretsPath, { recursive: true });
    const filePath = path.join(secretsPath, 'provider-secrets.json');
    fs.writeFileSync(filePath, '{not-json', 'utf8');

    expect(() => secretStorageService.hasSecretRecord('provider-test-api-key')).toThrow(SecretStoreCorruptError);
    expect(fs.existsSync(filePath)).toBe(false);
    const quarantined = fs.readdirSync(secretsPath).filter((entry) => entry.includes('.corrupt-'));
    expect(quarantined.length).toBe(1);
  });

  it('stores and decrypts with safeStorage only', async () => {
    const { secretStorageService } = await import('./SecretStorageService');
    secretStorageService.setSecret('provider-test-api-key', 'sk-live-secret');
    expect(secretStorageService.getSecret('provider-test-api-key')).toBe('sk-live-secret');
    expect(secretStorageService.maskSecretPreview('sk-live-secret')).toBe('••••cret');
  });
});
