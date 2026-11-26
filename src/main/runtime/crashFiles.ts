import fs from 'node:fs';
import path from 'node:path';
import { app, crashReporter } from 'electron';
import { appPathService } from './AppPathService';
import type { CrashFilesSummary } from '@shared/types/lifecycle';

/** Startup retention: at most the five newest minidumps, none older than fourteen days. */
export const CRASH_FILE_RETENTION = Object.freeze({ maxFiles: 5, maxAgeMs: 14 * 24 * 60 * 60 * 1000 });

export interface CrashDump {
  path: string;
  mtimeMs: number;
  size: number;
}

/** `<appStateRoot>/crash`: Crashpad's database for this data directory. Nothing in it is ever uploaded or exported. */
export function crashDirectory(): string {
  return path.join(appPathService.getAppStatePaths().appStateRoot, 'crash');
}

/**
 * Minidumps are written by Electron's own crash reporter (Crashpad), which runs outside this process, so a crash of
 * the main process itself still leaves one. Uploading is off: the files stay on this machine for the person to send if
 * they choose. The disposable Browser QA instance does not start it.
 */
export function startLocalCrashReporter(directory = crashDirectory()): void {
  fs.mkdirSync(directory, { recursive: true });
  app.setPath('crashDumps', directory);
  crashReporter.start({ uploadToServer: false, compress: true });
}

/** The minidumps under the crash directory (Crashpad keeps them in its new, pending and completed folders), newest first. */
export function listCrashDumps(directory = crashDirectory()): CrashDump[] {
  const dumps: CrashDump[] = [];
  const visit = (current: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith('.dmp')) {
        const stat = fs.statSync(full);
        dumps.push({ path: full, mtimeMs: stat.mtimeMs, size: stat.size });
      }
    }
  };
  visit(directory);
  return dumps.sort((left, right) => right.mtimeMs - left.mtimeMs);
}

export function summarizeCrashFiles(directory = crashDirectory()): CrashFilesSummary {
  const dumps = listCrashDumps(directory);
  return { count: dumps.length, bytes: dumps.reduce((total, dump) => total + dump.size, 0) };
}

/** Removes the minidumps outside the retention window; returns how many went. */
export function pruneCrashDumps(now = Date.now(), directory = crashDirectory()): number {
  const stale = listCrashDumps(directory).filter(
    (dump, index) => index >= CRASH_FILE_RETENTION.maxFiles || now - dump.mtimeMs > CRASH_FILE_RETENTION.maxAgeMs,
  );
  for (const dump of stale) fs.rmSync(dump.path, { force: true });
  return stale.length;
}

/** Settings › Clear crash files: every minidump goes; Crashpad's own bookkeeping stays. */
export function clearCrashDumps(directory = crashDirectory()): CrashFilesSummary {
  for (const dump of listCrashDumps(directory)) fs.rmSync(dump.path, { force: true });
  return summarizeCrashFiles(directory);
}
