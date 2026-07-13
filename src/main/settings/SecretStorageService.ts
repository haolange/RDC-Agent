import fs from 'fs';
import path from 'path';
import { safeStorage } from 'electron';
import { sanitizeToken } from '@shared/utils/id';
import { appPathService } from '../runtime/AppPathService';

interface SecretRecord {
  encoding: 'safeStorage' | 'base64';
  payload: string;
  updatedAt: string;
}

type SecretMap = Record<string, SecretRecord>;

const SECRET_FILE_NAME = 'provider-secrets.json';

export class SecretStorageService {
  private getSecretFilePath(_workspaceRoot = appPathService.getUserRdxRoot()): string {
    return path.join(appPathService.getRuntimePaths().secretsPath, SECRET_FILE_NAME);
  }

  private readSecretMap(workspaceRoot?: string): SecretMap {
    const filePath = this.getSecretFilePath(workspaceRoot);
    if (!fs.existsSync(filePath)) {
      return {};
    }

    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as SecretMap;
    } catch (error) {
      console.warn('[SecretStorageService] Failed to read secrets file:', error);
      return {};
    }
  }

  private writeSecretMap(secretMap: SecretMap, workspaceRoot?: string): void {
    const filePath = this.getSecretFilePath(workspaceRoot);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, JSON.stringify(secretMap, null, 2), 'utf8');
      fs.renameSync(temporaryPath, filePath);
    } finally {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
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

  moveSecret(sourceRef: string, targetRef: string, workspaceRoot?: string): boolean {
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
    }
    delete secretMap[sourceRef];
    this.writeSecretMap(secretMap, workspaceRoot);
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

    try {
      if (entry.encoding === 'safeStorage') {
        if (!safeStorage.isEncryptionAvailable()) {
          console.warn('[SecretStorageService] safeStorage is unavailable for secret:', secretRef);
          return '';
        }
        return safeStorage.decryptString(Buffer.from(entry.payload, 'base64'));
      }
      return Buffer.from(entry.payload, 'base64').toString('utf8');
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

    const encryptionAvailable = process.env.RDC_AGENT_TEST_MODE !== '1' && safeStorage.isEncryptionAvailable();
    secretMap[secretRef] = {
      encoding: encryptionAvailable ? 'safeStorage' : 'base64',
      payload: encryptionAvailable
        ? safeStorage.encryptString(normalized).toString('base64')
        : Buffer.from(normalized, 'utf8').toString('base64'),
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
}

export const secretStorageService = new SecretStorageService();
