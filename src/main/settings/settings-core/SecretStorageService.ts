import path from 'path';
import { safeStorage } from 'electron';
import { sanitizeToken } from '@shared/utils/id';
import { AppError } from '@shared/errors/appError';
import { appPathService } from '../../runtime/AppPathService';
import { parseJsonWith, readValidatedSync, writeFileAtomicSync } from '../../runtime/atomicFile';
import { hardenSecretFile, secretStorageUnavailableReason } from '../../platform/secrets';

interface SecretRecord {
  encoding: 'safeStorage';
  payload: string;
  updatedAt: string;
}

type SecretMap = Record<string, SecretRecord>;

const SECRET_FILE_NAME = 'provider-secrets.json';

export class SecretStorageUnavailableError extends AppError {
  constructor(message = 'OS safeStorage is unavailable; refusing to store credentials.') {
    super('SECRET_STORAGE_UNAVAILABLE', message);
    this.name = 'SecretStorageUnavailableError';
  }
}

function assertSafeStorageAvailable(): void {
  const reason = secretStorageUnavailableReason(safeStorage);
  if (reason) {
    throw new SecretStorageUnavailableError(reason);
  }
}

export class SecretStorageService {
  private getSecretFilePath(_workspaceRoot = appPathService.getUserRdcRoot()): string {
    return path.join(appPathService.getRuntimePaths().secretsPath, SECRET_FILE_NAME);
  }

  /** A damaged secret map is STORAGE_CORRUPT on every read (never an empty map), so credentials are not silently dropped. */
  private readSecretMap(workspaceRoot?: string): SecretMap {
    return readValidatedSync(this.getSecretFilePath(workspaceRoot), parseJsonWith((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('secret map is not an object');
      return value as SecretMap;
    })) ?? {};
  }

  private writeSecretMap(secretMap: SecretMap, workspaceRoot?: string): void {
    const filePath = this.getSecretFilePath(workspaceRoot);
    writeFileAtomicSync(filePath, `${JSON.stringify(secretMap, null, 2)}\n`, { mode: 0o600 });
    hardenSecretFile(filePath);
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
