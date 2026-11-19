/**
 * Host path rules: comparison identity, home expansion, long-path prefixes and
 * per-user application directories. Windows file systems fold case, so the
 * comparison key folds case there and nowhere else.
 */
import os from 'node:os';
import path from 'node:path';
import { currentHost, type HostDescriptor } from './host';

function pathApi(host: HostDescriptor): path.PlatformPath {
  return host.isWindows ? path.win32 : path.posix;
}

/** Comparison key for a path that is already in its final (absolute or relative) form. */
export function pathComparisonKey(value: string, host: HostDescriptor = currentHost()): string {
  return host.isWindows ? value.normalize('NFC').toLowerCase() : value;
}

/** Comparison key of the absolute form of `value`. */
export function resolvedPathKey(value: string, host: HostDescriptor = currentHost()): string {
  return pathComparisonKey(pathApi(host).resolve(value), host);
}

export function samePath(left: string, right: string, host: HostDescriptor = currentHost()): boolean {
  return resolvedPathKey(left, host) === resolvedPathKey(right, host);
}

/** Expands `~` and `~/…` everywhere, plus `~\…` and a leading `%USERPROFILE%` on Windows. */
export function expandHomePath(
  value: string,
  host: HostDescriptor = currentHost(),
  home: string = os.homedir(),
): string {
  const trimmed = value.trim();
  if (trimmed === '~') return home;
  if (trimmed.startsWith('~/') || (host.isWindows && trimmed.startsWith('~\\'))) {
    return pathApi(host).resolve(home, trimmed.slice(2));
  }
  return host.isWindows ? trimmed.replace(/^%USERPROFILE%/i, home) : trimmed;
}

/** Removes the Windows `\\?\` / `\\?\UNC\` prefix that native realpath may return. */
export function stripLongPathPrefix(value: string, host: HostDescriptor = currentHost()): string {
  if (!host.isWindows) return value;
  if (value.startsWith('\\\\?\\UNC\\')) return `\\\\${value.slice(8)}`;
  if (value.startsWith('\\\\?\\')) return value.slice(4);
  return value;
}

/** Per-user application data root used when Electron cannot report `appData`. */
export function defaultAppDataDir(host: HostDescriptor = currentHost(), home: string = os.homedir()): string {
  return host.isWindows ? pathApi(host).join(home, 'AppData', 'Roaming') : pathApi(host).join(home, '.config');
}

/** The Windows roaming profile directory (`%APPDATA%`); other hosts have none. */
export function roamingAppDataDir(host: HostDescriptor = currentHost()): string | null {
  if (!host.isWindows) return null;
  return process.env.APPDATA?.trim() || null;
}

/** File names a PATH lookup tries for `command`: Windows appends each PATHEXT extension to a bare name. */
export function commandFileNames(
  command: string,
  host: HostDescriptor = currentHost(),
  pathExt: string = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD;.VBS;.JS',
): string[] {
  if (!host.isWindows || pathApi(host).extname(command)) return [command];
  const extensions = pathExt.split(';').map((entry) => entry.trim()).filter(Boolean);
  return [command, ...extensions.map((extension) => `${command}${extension}`)];
}

/** Link type that creates a directory link without elevated rights on this host. */
export function directoryLinkType(host: HostDescriptor = currentHost()): 'junction' | 'dir' {
  return host.isWindows ? 'junction' : 'dir';
}
