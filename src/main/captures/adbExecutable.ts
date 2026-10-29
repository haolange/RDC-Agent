import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { RdcCliInvokerSettings } from '@shared/types/settings';
import { configuredInstallationRoot } from '../tools/RdcInstallationService';

/** Reads the selected Tools installation, never searches PATH or another SDK. */
export class AdbExecutableCache {
  private cachedPath: string | null = null;
  private cacheKey = '';
  invalidate(): void { this.cachedPath = null; this.cacheKey = ''; }
  getCachedPath(): string | null { return this.cachedPath; }

  async resolveAdbExecutableAsync(settings: RdcCliInvokerSettings): Promise<string> {
    const root = configuredInstallationRoot(settings);
    if (!root) throw new Error('RDC_INSTALLATION_INVALID: verify the selected RDC-Tool installation in Settings.');
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
      const binaryRoot = path.join(root, 'binaries', 'windows', 'x64');
      const manifest = JSON.parse(await fs.readFile(path.join(binaryRoot, 'manifest.runtime.json'), 'utf8')) as {
        bundled_tools?: { adb?: { path?: string } }; files: Array<{ path: string; sha256: string }>;
      };
      const relative = manifest.bundled_tools?.adb?.path;
      if (!relative || path.isAbsolute(relative)) throw new Error('ADB_MISSING: selected RDC-Tool has no bundled ADB metadata. Verify or repair the installation.');
      executable = path.resolve(binaryRoot, relative);
      if (!executable.startsWith(`${binaryRoot}${path.sep}`)) throw new Error('ADB_INVALID: bundled ADB path escapes the installation.');
      if ((await fs.realpath(executable)).toLowerCase() !== executable.toLowerCase()) throw new Error('ADB_INVALID: bundled ADB must not redirect outside its installation.');
      const record = manifest.files.find((item) => item.path === relative);
      const bytes = await fs.readFile(executable);
      if (!record || createHash('sha256').update(bytes).digest('hex') !== record.sha256) {
        throw new Error('ADB_INVALID: bundled ADB integrity check failed. Repair the selected RDC-Tool installation.');
      }
    }
    if (!(await fs.stat(executable)).isFile()) throw new Error('ADB_MISSING: configured ADB is not a regular file.');
    this.cachedPath = await fs.realpath(executable); this.cacheKey = key;
    return this.cachedPath;
  }
}
