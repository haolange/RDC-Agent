import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '@shared/errors/appError';
import { samePath } from '../../platform/paths';
import { rdcInstallationFiles } from '../../platform/rdcLayout';
import { configuredInstallationRoot } from '../RdcInstallationService';
import type { RdcCliInvokerSettings } from '@shared/types/settings';

/** The fields of RDC-Tool's runtime manifest this module reads; the manifest may carry others. */
const RuntimeManifestSchema = z.object({
  bundled_tools: z.object({ adb: z.object({ path: z.string().optional() }).passthrough().optional() }).passthrough().optional(),
  files: z.array(z.object({ path: z.string(), sha256: z.string() }).passthrough()),
}).passthrough();

async function readRuntimeManifest(binaryRoot: string): Promise<z.infer<typeof RuntimeManifestSchema>> {
  const manifestPath = path.join(binaryRoot, 'manifest.runtime.json');
  const text = await fs.readFile(manifestPath, 'utf8');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new AppError('RDC_INSTALLATION_INVALID', `${manifestPath} is not JSON. Verify or repair the installation.`, { cause: error });
  }
  const manifest = RuntimeManifestSchema.safeParse(value);
  if (!manifest.success) {
    throw new AppError('RDC_INSTALLATION_INVALID', `${manifestPath} is malformed: ${z.prettifyError(manifest.error)}. Verify or repair the installation.`);
  }
  return manifest.data;
}

/** Reads the selected Tools installation, never searches PATH or another SDK. */
export class AdbExecutableCache {
  private cachedPath: string | null = null;
  private cacheKey = '';
  invalidate(): void { this.cachedPath = null; this.cacheKey = ''; }
  getCachedPath(): string | null { return this.cachedPath; }

  async resolveAdbExecutableAsync(settings: RdcCliInvokerSettings): Promise<string> {
    const root = configuredInstallationRoot(settings);
    if (!root) throw new AppError('RDC_INSTALLATION_INVALID', 'verify the selected RDC-Tool installation in Settings.');
    const override = (settings.env.RDC_TOOL_ANDROID_ADB_PATH ?? process.env.RDC_TOOL_ANDROID_ADB_PATH ?? '').trim();
    const key = JSON.stringify([root, override ?? '']);
    if (key === this.cacheKey && this.cachedPath) {
      try { await fs.access(this.cachedPath); return this.cachedPath; } catch { this.invalidate(); }
    }
    let executable: string;
    if (override?.trim()) {
      if (!path.isAbsolute(override)) throw new Error('RDC_TOOL_ANDROID_ADB_PATH must be an absolute path.');
      executable = override;
    } else {
      const binaryRoot = rdcInstallationFiles(root).runtimeDir;
      const manifest = await readRuntimeManifest(binaryRoot);
      const relative = manifest.bundled_tools?.adb?.path;
      if (!relative || path.isAbsolute(relative)) throw new AppError('ADB_MISSING', 'selected RDC-Tool has no bundled ADB metadata. Verify or repair the installation.');
      executable = path.resolve(binaryRoot, relative);
      if (!executable.startsWith(`${binaryRoot}${path.sep}`)) throw new AppError('ADB_INVALID', 'bundled ADB path escapes the installation.');
      if (!samePath(await fs.realpath(executable), executable)) throw new AppError('ADB_INVALID', 'bundled ADB must not redirect outside its installation.');
      const record = manifest.files.find((item) => item.path === relative);
      const bytes = await fs.readFile(executable);
      if (!record || createHash('sha256').update(bytes).digest('hex') !== record.sha256) {
        throw new AppError('ADB_INVALID', 'bundled ADB integrity check failed. Repair the selected RDC-Tool installation.');
      }
    }
    if (!(await fs.stat(executable)).isFile()) throw new AppError('ADB_MISSING', 'configured ADB is not a regular file.');
    this.cachedPath = await fs.realpath(executable); this.cacheKey = key;
    return this.cachedPath;
  }
}
