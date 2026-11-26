import path from 'path';
import { EventEmitter } from 'events';
import { ModelsOverrideSchema, type ModelsOverride } from '@shared/provider-catalog/modelsOverrideSchema';
import { appPathService } from '../../runtime/AppPathService';
import { parseJsonWith, readValidatedSync, writeFileAtomicSync } from '../../runtime/atomicFile';

const MODELS_OVERRIDE_FILE = 'models.json';

export interface ModelsOverrideChangeEvent {
  overrides: ModelsOverride;
  updatedAt: string;
}

export class ModelsOverrideService extends EventEmitter {
  private cache: ModelsOverride | null = null;

  private getFilePath(): string {
    return path.join(appPathService.getUserRdcRoot(), MODELS_OVERRIDE_FILE);
  }

  getOverrides(): ModelsOverride {
    this.cache ??= readValidatedSync(
      this.getFilePath(),
      parseJsonWith((value) => ModelsOverrideSchema.parse(value)),
    ) ?? { schemaVersion: 1, providers: {} };
    return this.cache;
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
    writeFileAtomicSync(this.getFilePath(), `${JSON.stringify(overrides, null, 2)}\n`, { mode: 0o600 });
  }
}

export const modelsOverrideService = new ModelsOverrideService();
