import fs from 'fs';
import path from 'path';
import { safeStorage } from 'electron';
import { sanitizeToken } from '@shared/utils/id';
import { appPathService } from './AppPathService';

interface SecretRecord {
  encoding: 'safeStorage' | 'base64';
  payload: string;
  updatedAt: string;
}

type SecretMap = Record<string, SecretRecord>;

const SECRET_FILE_NAME = 'provider-secrets.json';

export class SecretStorageService {
  private getSecretFilePath(workspaceRoot = appPathService.getWorkspaceRoot()): string {
    return path.join(appPathService.getWorkspacePaths(workspaceRoot).secretsPath, SECRET_FILE_NAME);
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
    fs.writeFileSync(filePath, JSON.stringify(secretMap, null, 2), 'utf8');
  }

  createProviderSecretRef(providerId: string): string {
    return `provider-${sanitizeToken(providerId)}-api-key`;
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
      if (entry.encoding === 'safeStorage' && safeStorage.isEncryptionAvailable()) {
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

    const encryptionAvailable = safeStorage.isEncryptionAvailable();
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
