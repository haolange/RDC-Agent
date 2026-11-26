import { createHash } from 'crypto';
import { errorCodeOf } from '@shared/errors/appError';
import { appPathService } from '../../runtime/AppPathService';
import { parseJsonWith, readValidatedSync, writeFileAtomicSync } from '../../runtime/atomicFile';
import { secretStorageService } from './SecretStorageService';
import { SettingsFileError, assertSettingsFile, parseSettingsFile, type SettingsFile } from './settingsFileSchema';
import type { LlmProviderEntry, SettingsDiagnostic } from '@shared/types/settings';

export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(',')}}`;
  }
  return (JSON.stringify(value) as string | undefined) ?? 'null';
}

export function hashProviderDefinition(provider: LlmProviderEntry): string {
  return createHash('sha256')
    .update(stableSerialize({ ...provider, apiKey: '' }), 'utf8')
    .digest('hex');
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * The one read of the settings file: missing is `null` (defaults, nothing written); anything that is not a valid v9
 * document is a `SettingsFileError` naming the file, whatever the storage primitive reported.
 */
export function readSettingsFile(): SettingsFile | null {
  const filePath = appPathService.getRuntimePaths().settingsPath;
  try {
    return readValidatedSync(filePath, parseJsonWith(parseSettingsFile));
  } catch (error) {
    const code = errorCodeOf(error);
    if (code === 'STORAGE_CORRUPT' || code === 'STORAGE_SCHEMA_UNSUPPORTED' || code === 'STORAGE_UNREADABLE') {
      throw new SettingsFileError(code, filePath, { cause: error });
    }
    throw error;
  }
}

/** Writes the whole document compactly and atomically; callers write only when something actually changed. */
export function writeSettingsFile(file: SettingsFile): void {
  writeFileAtomicSync(appPathService.getRuntimePaths().settingsPath, JSON.stringify(assertSettingsFile(file)));
}

export function deleteSecretsAfterCommit(secretRefs: Iterable<string>, workspaceRoot: string): void {
  for (const secretRef of new Set(secretRefs)) {
    secretStorageService.deleteSecret(secretRef, workspaceRoot);
  }
}

export function orphanProviderDiagnostics(providerIds: string[], settingsPath: string): SettingsDiagnostic[] {
  return providerIds.map((providerId) => ({
    code: 'settings_provider_not_in_catalog',
    severity: 'warning',
    message: `Stored settings for provider ${providerId} are kept but not used: the provider catalog no longer lists it.`,
    path: settingsPath,
  }));
}
