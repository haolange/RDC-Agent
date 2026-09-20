import * as fs from 'fs';
import * as path from 'path';

export function adbUnavailableMessage(): string {
  return 'adb executable not found. Configure RDC_ANDROID_ADB_PATH or install Android platform-tools.';
}

export function candidateAdbPaths(): string[] {
  const candidates: string[] = [];
  const push = (value?: string) => {
    const trimmed = value?.trim();
    if (trimmed) {
      candidates.push(trimmed);
    }
  };

  push(process.env.RDC_ANDROID_ADB_PATH);
  push(process.env.ADB);

  for (const envName of ['ANDROID_SDK_ROOT', 'ANDROID_HOME']) {
    const root = process.env[envName]?.trim();
    if (!root) {
      continue;
    }
    push(path.join(root, 'platform-tools', 'adb.exe'));
    push(path.join(root, 'platform-tools', 'adb'));
  }

  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (localAppData) {
    push(path.join(localAppData, 'Android', 'Sdk', 'platform-tools', 'adb.exe'));
  }

  return candidates;
}

async function pathIsAccessible(candidate: string): Promise<boolean> {
  try {
    await fs.promises.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function resolveFromCandidates(): Promise<string | null> {
  for (const candidate of candidateAdbPaths()) {
    if (await pathIsAccessible(candidate)) {
      return path.resolve(candidate);
    }
  }

  for (const entry of (process.env.PATH ?? '').split(path.delimiter)) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }

    for (const adbName of ['adb.exe', 'adb']) {
      const candidate = path.join(trimmed, adbName);
      if (await pathIsAccessible(candidate)) {
        return path.resolve(candidate);
      }
    }
  }

  return null;
}

/** Cached async adb resolver — invalidate after spawn/access failure. */
export class AdbExecutableCache {
  private cachedPath: string | null = null;

  invalidate(): void {
    this.cachedPath = null;
  }

  getCachedPath(): string | null {
    return this.cachedPath;
  }

  async resolveAdbExecutableAsync(): Promise<string> {
    if (this.cachedPath) {
      if (await pathIsAccessible(this.cachedPath)) {
        return this.cachedPath;
      }
      this.cachedPath = null;
    }

    const resolved = await resolveFromCandidates();
    if (!resolved) {
      throw new Error(adbUnavailableMessage());
    }

    this.cachedPath = resolved;
    return resolved;
  }
}
