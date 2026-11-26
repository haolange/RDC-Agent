import path from 'path';
import { safeStorage } from 'electron';
import { sanitizeToken } from '@shared/utils/id';
import { AppError } from '@shared/errors/appError';
import { appPathService } from '../../runtime/AppPathService';
import { parseJsonWith, readValidatedSync, writeFileAtomicSync } from '../../runtime/atomicFile';
import { hardenSecretFile, secretStorageUnavailableReason } from '../../platform/secrets';
import { StampedValue, fileStamp } from '../../runtime/externalInput';

interface SecretRecord {
  /** Written as safeStorage; the map is read back checked only as an object, so getSecret refuses any other value. */
  encoding: string;
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

/**
 * The secret map is read once and kept in memory with the file's stamp; decrypted values are kept per ref. Writes
 * here replace both; an edit made outside the app is noticed by `revalidate` (turn preparation, Settings open).
 */
export class SecretStorageService {
  private secretFilePath = '';
  private revisionOffset = 0;
  private readonly decrypted = new Map<string, string>();
  private secretMap = this.createSecretMapCache();

  private getSecretFilePath(): string {
    return path.join(appPathService.getRuntimePaths().secretsPath, SECRET_FILE_NAME);
  }

  private createSecretMapCache(): StampedValue<SecretMap> {
    return new StampedValue(
      () => fileStamp(this.secretFilePath),
      () =>
        readValidatedSync(
          this.secretFilePath,
          parseJsonWith((value) => {
            if (!value || typeof value !== 'object' || Array.isArray(value))
              throw new Error('secret map is not an object');
            return value as SecretMap;
          }),
        ) ?? {},
    );
  }

  /** A damaged secret map is STORAGE_CORRUPT on every read (never an empty map), so credentials are not silently dropped. */
  private readSecretMap(): SecretMap {
    this.followSecretFilePath();
    return this.secretMap.get();
  }

  /** A copy to change and write; the cached map changes only once the write succeeded. */
  private editableSecretMap(): SecretMap {
    return { ...this.readSecretMap() };
  }

  private writeSecretMap(secretMap: SecretMap): void {
    const filePath = this.getSecretFilePath();
    writeFileAtomicSync(filePath, `${JSON.stringify(secretMap, null, 2)}\n`, { mode: 0o600 });
    hardenSecretFile(filePath);
    this.decrypted.clear();
    this.secretMap.set(secretMap);
  }

  /** Changes whenever the stored secrets change, through the app or (after `revalidate`) outside it. */
  get revision(): number {
    return this.revisionOffset + this.secretMap.revision;
  }

  /** Re-checks the secret file's stamp; true when it changed outside the app since it was read. */
  revalidate(): boolean {
    this.followSecretFilePath();
    const changed = this.secretMap.revalidate();
    if (changed) this.decrypted.clear();
    return changed;
  }

  /** The secrets path moves with the user resource root (tests and isolated Browser QA homes). */
  private followSecretFilePath(): void {
    const filePath = this.getSecretFilePath();
    if (filePath !== this.secretFilePath) {
      this.revisionOffset += this.secretMap.revision + 1;
      this.secretFilePath = filePath;
      this.secretMap = this.createSecretMapCache();
      this.decrypted.clear();
    }
  }

  createProviderSecretRef(providerId: string): string {
    return `provider-${sanitizeToken(providerId)}-api-key`;
  }

  createProviderOAuthSecretRef(providerId: string): string {
    return `provider-${sanitizeToken(providerId)}-oauth`;
  }

  createProviderAccountSecretRef(providerId: string, accountId: string, kind: 'api-key' | 'oauth'): string {
    return `provider-${sanitizeToken(providerId)}-account-${sanitizeToken(accountId)}-${kind}`;
  }

  createProviderConnectionSecretRef(providerId: string, accountId: string, fieldId: string): string {
    return `${sanitizeToken(providerId)}:${sanitizeToken(accountId)}:connection:${sanitizeToken(fieldId)}`;
  }

  copySecret(sourceRef: string, targetRef: string, _workspaceRoot?: string): boolean {
    if (!sourceRef || !targetRef || sourceRef === targetRef) {
      return false;
    }
    const secretMap = this.editableSecretMap();
    const source = secretMap[sourceRef];
    if (!source) {
      return false;
    }
    if (!secretMap[targetRef]) {
      secretMap[targetRef] = source;
      this.writeSecretMap(secretMap);
    }
    return true;
  }

  getSecret(secretRef: string | undefined, _workspaceRoot?: string): string {
    if (!secretRef) {
      return '';
    }
    const secretMap = this.readSecretMap();
    const cached = this.decrypted.get(secretRef);
    if (cached !== undefined) return cached;
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
      const plaintext = safeStorage.decryptString(Buffer.from(entry.payload, 'base64'));
      this.decrypted.set(secretRef, plaintext);
      return plaintext;
    } catch (error) {
      console.warn('[SecretStorageService] Failed to decrypt secret:', error);
      return '';
    }
  }

  setSecret(secretRef: string | undefined, plaintext: string, _workspaceRoot?: string): void {
    if (!secretRef) {
      return;
    }
    const normalized = plaintext.trim();
    const secretMap = this.editableSecretMap();

    if (!normalized) {
      delete secretMap[secretRef];
      this.writeSecretMap(secretMap);
      return;
    }

    assertSafeStorageAvailable();
    secretMap[secretRef] = {
      encoding: 'safeStorage',
      payload: safeStorage.encryptString(normalized).toString('base64'),
      updatedAt: new Date().toISOString(),
    };

    this.writeSecretMap(secretMap);
  }

  deleteSecret(secretRef: string | undefined, _workspaceRoot?: string): void {
    if (!secretRef) {
      return;
    }
    const secretMap = this.editableSecretMap();
    if (!(secretRef in secretMap)) {
      return;
    }
    delete secretMap[secretRef];
    this.writeSecretMap(secretMap);
  }

  hasSecret(secretRef?: string, workspaceRoot?: string): boolean {
    return Boolean(secretRef && this.getSecret(secretRef, workspaceRoot));
  }

  hasSecretRecord(secretRef?: string, _workspaceRoot?: string): boolean {
    return Boolean(secretRef && this.readSecretMap()[secretRef]);
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
