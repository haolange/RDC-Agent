import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { safeStorage } from 'electron';
import { sanitizeToken } from '@shared/utils/id';
import { appPathService } from '../runtime/AppPathService';

interface SecretRecord {
  encoding: 'safeStorage';
  payload: string;
  updatedAt: string;
}

type SecretMap = Record<string, SecretRecord>;

const SECRET_FILE_NAME = 'provider-secrets.json';

export class SecretStorageUnavailableError extends Error {
  constructor(message = 'OS safeStorage is unavailable; refusing to store credentials.') {
    super(message);
    this.name = 'SecretStorageUnavailableError';
  }
}

export class SecretStoreCorruptError extends Error {
  readonly quarantinePath: string;

  constructor(quarantinePath: string, cause?: unknown) {
    super(`Secret store is corrupt; quarantined to ${quarantinePath}`);
    this.name = 'SecretStoreCorruptError';
    this.quarantinePath = quarantinePath;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

function assertSafeStorageAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new SecretStorageUnavailableError();
  }
}

function applySecretFileMode(filePath: string): void {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows may ignore POSIX mode bits; ACL hardening is best-effort below.
  }
  if (process.platform === 'win32' && process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
    try {
      // Restrict the secret file to the current user where icacls is available.
      spawnSync('icacls', [filePath, '/inheritance:r', '/grant:r', `${process.env.USERNAME}:F`], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {
      // Best-effort Windows ACL.
    }
  }
}

function fsyncPath(targetPath: string): void {
  const fd = fs.openSync(targetPath, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export class SecretStorageService {
  private getSecretFilePath(_workspaceRoot = appPathService.getUserRdcRoot()): string {
    return path.join(appPathService.getRuntimePaths().secretsPath, SECRET_FILE_NAME);
  }

  private quarantineCorruptFile(filePath: string, cause: unknown): never {
    const quarantinePath = `${filePath}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(filePath, quarantinePath);
    } catch (renameError) {
      throw new SecretStoreCorruptError(filePath, renameError);
    }
    throw new SecretStoreCorruptError(quarantinePath, cause);
  }

  private readSecretMap(workspaceRoot?: string): SecretMap {
    const filePath = this.getSecretFilePath(workspaceRoot);
    if (!fs.existsSync(filePath)) {
      return {};
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as SecretMap;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.quarantineCorruptFile(filePath, new Error('Secret map is not an object'));
      }
      return parsed;
    } catch (error) {
      if (error instanceof SecretStoreCorruptError) {
        throw error;
      }
      this.quarantineCorruptFile(filePath, error);
    }
  }

  private writeSecretMap(secretMap: SecretMap, workspaceRoot?: string): void {
    const filePath = this.getSecretFilePath(workspaceRoot);
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    const payload = `${JSON.stringify(secretMap, null, 2)}\n`;
    try {
      const fd = fs.openSync(temporaryPath, 'w', 0o600);
      try {
        fs.writeFileSync(fd, payload, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      try {
        fs.renameSync(temporaryPath, filePath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST' && code !== 'EPERM') throw error;
        fs.rmSync(filePath, { force: true, maxRetries: 5, retryDelay: 100 });
        fs.renameSync(temporaryPath, filePath);
      }
      applySecretFileMode(filePath);
      try {
        fsyncPath(directory);
      } catch {
        // Directory fsync is best-effort on some platforms.
      }
    } finally {
      try {
        fs.rmSync(temporaryPath, { force: true, maxRetries: 5, retryDelay: 100 });
      } catch (error) {
        // Cleanup is best-effort: the durable rename already succeeded, and Windows
        // may retain a transient ACL handle for the temporary path.
        void error;
      }
    }
  }

  createProviderSecretRef(providerId: string): string {
    return `provider-${sanitizeToken(providerId)}-api-key`;
  }

  createProviderOAuthSecretRef(providerId: string): string {
    return `provider-${sanitizeToken(providerId)}-oauth`;
  }

  createProviderAccountSecretRef(
    providerId: string,
    accountId: string,
    kind: 'api-key' | 'oauth',
  ): string {
    return `provider-${sanitizeToken(providerId)}-account-${sanitizeToken(accountId)}-${kind}`;
  }

  createProviderConnectionSecretRef(providerId: string, accountId: string, fieldId: string): string {
    return `${sanitizeToken(providerId)}:${sanitizeToken(accountId)}:connection:${sanitizeToken(fieldId)}`;
  }

  copySecret(sourceRef: string, targetRef: string, workspaceRoot?: string): boolean {
    if (!sourceRef || !targetRef || sourceRef === targetRef) {
      return false;
    }
    const secretMap = this.readSecretMap(workspaceRoot);
    const source = secretMap[sourceRef];
    if (!source) {
      return false;
    }
    if (!secretMap[targetRef]) {
      secretMap[targetRef] = source;
      this.writeSecretMap(secretMap, workspaceRoot);
    }
    return true;
  }

  getSecret(secretRef: string | undefined, workspaceRoot?: string): string {
    if (!secretRef) {
      return '';
    }
    const secretMap = this.readSecretMap(workspaceRoot);
    const entry = secretMap[secretRef];
    if (!entry) {
      return '';
    }

    if (entry.encoding !== 'safeStorage') {
      console.warn('[SecretStorageService] Refusing unsupported non-safeStorage secret encoding for:', secretRef);
      return '';
    }

    try {
      assertSafeStorageAvailable();
      return safeStorage.decryptString(Buffer.from(entry.payload, 'base64'));
    } catch (error) {
      console.warn('[SecretStorageService] Failed to decrypt secret:', error);
      return '';
    }
  }

  setSecret(secretRef: string | undefined, plaintext: string, workspaceRoot?: string): void {
    if (!secretRef) {
      return;
    }
    const normalized = plaintext.trim();
    const secretMap = this.readSecretMap(workspaceRoot);

    if (!normalized) {
      delete secretMap[secretRef];
      this.writeSecretMap(secretMap, workspaceRoot);
      return;
    }

    assertSafeStorageAvailable();
    secretMap[secretRef] = {
      encoding: 'safeStorage',
      payload: safeStorage.encryptString(normalized).toString('base64'),
      updatedAt: new Date().toISOString(),
    };

    this.writeSecretMap(secretMap, workspaceRoot);
  }

  deleteSecret(secretRef: string | undefined, workspaceRoot?: string): void {
    if (!secretRef) {
      return;
    }
    const secretMap = this.readSecretMap(workspaceRoot);
    if (!(secretRef in secretMap)) {
      return;
    }
    delete secretMap[secretRef];
    this.writeSecretMap(secretMap, workspaceRoot);
  }

  hasSecret(secretRef?: string, workspaceRoot?: string): boolean {
    return Boolean(secretRef && this.getSecret(secretRef, workspaceRoot));
  }

  hasSecretRecord(secretRef?: string, workspaceRoot?: string): boolean {
    return Boolean(secretRef && this.readSecretMap(workspaceRoot)[secretRef]);
  }

  maskSecretPreview(plaintext: string): string | undefined {
    const normalized = plaintext.trim();
    if (!normalized) {
      return undefined;
    }
    if (normalized.length <= 4) {
      return '••••';
    }
    return `••••${normalized.slice(-4)}`;
  }
}

export const secretStorageService = new SecretStorageService();
