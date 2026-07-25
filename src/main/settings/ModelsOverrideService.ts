import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { ModelsOverrideSchema, type ModelsOverride } from '@shared/provider-catalog/modelsOverrideSchema';
import { appPathService } from '../runtime/AppPathService';

const MODELS_OVERRIDE_FILE = 'models.json';

export class ModelsOverrideCorruptError extends Error {
  readonly quarantinePath: string;

  constructor(quarantinePath: string, cause?: unknown) {
    super(`models.json is corrupt; quarantined to ${quarantinePath}`);
    this.name = 'ModelsOverrideCorruptError';
    this.quarantinePath = quarantinePath;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export interface ModelsOverrideChangeEvent {
  overrides: ModelsOverride;
  updatedAt: string;
}

export class ModelsOverrideService extends EventEmitter {
  private cache: ModelsOverride | null = null;

  private getFilePath(): string {
    return path.join(appPathService.getUserRdxRoot(), MODELS_OVERRIDE_FILE);
  }

  private quarantineCorruptFile(filePath: string, cause: unknown): never {
    const quarantinePath = `${filePath}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(filePath, quarantinePath);
    } catch (renameError) {
      throw new ModelsOverrideCorruptError(filePath, renameError);
    }
    throw new ModelsOverrideCorruptError(quarantinePath, cause);
  }

  getOverrides(): ModelsOverride {
    if (this.cache) return this.cache;
    const filePath = this.getFilePath();
    if (!fs.existsSync(filePath)) {
      const empty: ModelsOverride = { schemaVersion: 1, providers: {} };
      this.cache = empty;
      return empty;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
      const parsed = ModelsOverrideSchema.safeParse(raw);
      if (!parsed.success) {
        this.quarantineCorruptFile(filePath, parsed.error);
      }
      this.cache = parsed.data;
      return parsed.data;
    } catch (error) {
      if (error instanceof ModelsOverrideCorruptError) throw error;
      this.quarantineCorruptFile(filePath, error);
    }
  }

  setOverrides(overrides: ModelsOverride): ModelsOverride {
    const validated = ModelsOverrideSchema.parse(overrides);
    this.writeAtomic(validated);
    this.cache = validated;
    this.emit('change', {
      overrides: validated,
      updatedAt: new Date().toISOString(),
    } satisfies ModelsOverrideChangeEvent);
    return validated;
  }

  onChange(listener: (event: ModelsOverrideChangeEvent) => void): () => void {
    this.on('change', listener);
    return () => this.off('change', listener);
  }

  invalidateCache(): void {
    this.cache = null;
  }

  private writeAtomic(overrides: ModelsOverride): void {
    const filePath = this.getFilePath();
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    const payload = `${JSON.stringify(overrides, null, 2)}\n`;
    try {
      const fd = fs.openSync(temporaryPath, 'w', 0o600);
      try {
        fs.writeFileSync(fd, payload, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      try {
        fs.chmodSync(temporaryPath, 0o600);
      } catch {
        // Windows may ignore POSIX mode bits.
      }
      fs.renameSync(temporaryPath, filePath);
      try {
        fs.chmodSync(filePath, 0o600);
      } catch {
        // Best-effort on Windows.
      }
    } finally {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
    }
  }
}

export const modelsOverrideService = new ModelsOverrideService();
