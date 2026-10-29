import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { AdbExecutableCache } from './adbExecutable';
import type { RdcCliInvokerSettings } from '@shared/types/settings';
vi.mock('../tools/RdcInstallationService', () => ({ configuredInstallationRoot: (settings: RdcCliInvokerSettings) => settings.workingDirectory }));
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rdc-adb-')); roots.push(root);
  const binary = path.join(root, 'binaries/windows/x64');
  const adb = path.join(binary, 'adb/adb.exe');
  await fs.mkdir(path.dirname(adb), { recursive: true }); await fs.writeFile(adb, 'fixture');
  await fs.writeFile(path.join(binary, 'manifest.runtime.json'), JSON.stringify({
    bundled_tools: { adb: { path: 'adb/adb.exe' } }, files: [{ path: 'adb/adb.exe', sha256: createHash('sha256').update('fixture').digest('hex') }],
  }));
  const cli: RdcCliInvokerSettings = { enabled: true, command: 'python', argsPrefix: [], workingDirectory: root, env: { RDC_TOOL_ANDROID_ADB_PATH: '' }, timeoutMs: 1000 };
  return { adb, binary, cli };
}
it('uses the selected Tools manifest and caches its integrity check', async () => {
  const { adb, cli } = await setup(); const cache = new AdbExecutableCache();
  expect(await cache.resolveAdbExecutableAsync(cli)).toBe(await fs.realpath(adb));
  expect(await cache.resolveAdbExecutableAsync(cli)).toBe(await fs.realpath(adb));
  cache.invalidate(); await fs.writeFile(adb, 'tampered');
  await expect(cache.resolveAdbExecutableAsync(cli)).rejects.toThrow('integrity');
});
it('does not fall back when an explicit override is missing', async () => {
  const { cli } = await setup(); cli.env.RDC_TOOL_ANDROID_ADB_PATH = path.join(cli.workingDirectory, 'missing.exe');
  await expect(new AdbExecutableCache().resolveAdbExecutableAsync(cli)).rejects.toThrow();
});
it('rejects missing metadata and path traversal', async () => {
  const { binary, cli } = await setup(); const manifest = path.join(binary, 'manifest.runtime.json');
  await fs.writeFile(manifest, '{}'); await expect(new AdbExecutableCache().resolveAdbExecutableAsync(cli)).rejects.toThrow('metadata');
  await fs.writeFile(manifest, JSON.stringify({ bundled_tools: { adb: { path: '../../../../outside.exe' } } }));
  await expect(new AdbExecutableCache().resolveAdbExecutableAsync(cli)).rejects.toThrow('escapes');
});
