/**
 * Shared shell resolution for agent `shell`.
 * POSIX prefers $SHELL when the basename is zsh/bash/sh/dash, then zsh, bash, sh.
 * Windows prefers a real PowerShell 7 binary, then Windows PowerShell 5.1.
 * Store App Execution Aliases (0-byte WindowsApps stubs) are never preferred.
 * Unsupported interactive shells (fish/csh/nu/...) fail closed as SHELL_UNAVAILABLE.
 */

import { spawnSync, type SpawnSyncOptions } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export type ShellKind = 'pwsh' | 'windows-powershell' | 'zsh' | 'bash' | 'sh';

export interface ResolvedShell {
  executable: string;
  kind: ShellKind;
  version: string;
  versionMajor: number | null;
}

export interface ShellResolverDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homedir: () => string;
  existsSync: (filePath: string) => boolean;
  statSync: (filePath: string) => { size: number };
  spawnSync: typeof spawnSync;
}

export class ShellUnavailableError extends Error {
  readonly code = 'SHELL_UNAVAILABLE';

  constructor(detail = 'No usable shell executable was found.') {
    super(`SHELL_UNAVAILABLE: ${detail}`);
    this.name = 'ShellUnavailableError';
  }
}

const PROBE_TIMEOUT_MS = 8_000;
const POWERSHELL_VERSION_COMMAND = '$PSVersionTable.PSVersion.ToString()';
const POSIX_ALLOWED_BASENAMES = new Set(['zsh', 'bash', 'sh', 'dash']);
const UNSUPPORTED_POSIX_SHELLS = ['fish', 'csh', 'tcsh', 'nu', 'xonsh', 'elvish'] as const;

export function isWindowsAppsAliasPath(filePath: string): boolean {
  return /[/\\]WindowsApps[/\\]/i.test(filePath);
}

export function formatShellInterpreterLabel(kind: ShellKind): string {
  if (kind === 'pwsh') return 'PowerShell 7 (pwsh)';
  if (kind === 'windows-powershell') return 'Windows PowerShell 5.1';
  if (kind === 'zsh') return 'zsh';
  if (kind === 'bash') return 'bash';
  return 'sh';
}

export function formatShellDialect(kind: ShellKind): string {
  return kind === 'pwsh' || kind === 'windows-powershell' ? 'PowerShell' : 'POSIX sh';
}

export function parseShellVersionMajor(version: string): number | null {
  const match = version.trim().match(/^(\d+)/);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  return Number.isFinite(major) ? major : null;
}

function defaultDeps(): ShellResolverDeps {
  return {
    platform: process.platform,
    env: process.env,
    homedir: () => os.homedir(),
    existsSync: (filePath) => fs.existsSync(filePath),
    statSync: (filePath) => fs.statSync(filePath),
    spawnSync,
  };
}

function basenameWithoutExt(executable: string): string {
  return path.basename(executable).replace(/\.exe$/i, '').toLowerCase();
}

export class ShellResolver {
  private readonly deps: ShellResolverDeps;
  private readonly cache = new Map<string, ResolvedShell>();

  constructor(deps: Partial<ShellResolverDeps> = {}) {
    this.deps = { ...defaultDeps(), ...deps };
  }

  clearCache(): void {
    this.cache.clear();
  }

  resolve(overrideExecutable = ''): ResolvedShell {
    const key = overrideExecutable.trim();
    const cached = this.cache.get(key);
    if (cached) return cached;
    const resolved = key ? this.resolveOverride(key) : this.detect();
    this.cache.set(key, resolved);
    return resolved;
  }

  buildNonInteractiveArgs(kind: ShellKind, command: string): string[] {
    if (kind === 'pwsh' || kind === 'windows-powershell') {
      // 5.1 `-Command` plus `Write-Output`/`exit` drops the success pipeline
      // (including the cwd trailer). EncodedCommand + Console.Out is reliable.
      const encoded = Buffer.from(command, 'utf16le').toString('base64');
      return ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded];
    }
    return ['-lc', command];
  }

  private resolveOverride(executable: string): ResolvedShell {
    this.assertSupportedPosix(executable);
    const probed = this.probeCandidate(executable);
    if (!probed) {
      throw new ShellUnavailableError(`Configured shell is not usable: ${executable}`);
    }
    return probed;
  }

  private detect(): ResolvedShell {
    for (const candidate of this.listAutoCandidates()) {
      try {
        this.assertSupportedPosix(candidate);
      } catch {
        continue;
      }
      const probed = this.probeCandidate(candidate);
      if (probed) return probed;
    }
    throw new ShellUnavailableError();
  }

  private listAutoCandidates(): string[] {
    const { platform, env, homedir } = this.deps;
    if (platform === 'win32') {
      const programFiles = env.ProgramFiles || 'C:\\Program Files';
      const systemRoot = env.SystemRoot || 'C:\\Windows';
      return [
        path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
        ...this.listWhereMatches('pwsh'),
        path.join(homedir(), '.dotnet', 'tools', 'pwsh.exe'),
        path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        path.join(systemRoot, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        path.join(systemRoot, 'System32', 'powershell.exe'),
        path.join(systemRoot, 'Sysnative', 'powershell.exe'),
        '/bin/bash',
        '/bin/sh',
      ];
    }
    const preferred = this.resolvePreferredPosixShell();
    const defaults = [
      '/bin/zsh',
      '/bin/bash',
      '/bin/sh',
      '/usr/bin/zsh',
      '/usr/bin/bash',
      '/usr/bin/sh',
    ];
    return preferred ? [preferred, ...defaults.filter((entry) => entry !== preferred)] : defaults;
  }

  private resolvePreferredPosixShell(): string | null {
    const raw = this.deps.env.SHELL?.trim();
    if (!raw) return null;
    return POSIX_ALLOWED_BASENAMES.has(basenameWithoutExt(raw)) ? raw : null;
  }

  private assertSupportedPosix(executable: string): void {
    const base = basenameWithoutExt(executable);
    if ((UNSUPPORTED_POSIX_SHELLS as readonly string[]).includes(base)) {
      throw new ShellUnavailableError(
        `${base} is not a POSIX-compatible shell for agent commands. Configure zsh, bash, or sh.`,
      );
    }
  }

  private listWhereMatches(command: string): string[] {
    if (this.deps.platform !== 'win32') return [];
    const result = this.deps.spawnSync('where.exe', [command], this.spawnOptions());
    if (result.status !== 0 || !result.stdout) return [];
    return String(result.stdout)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private probeCandidate(executable: string): ResolvedShell | null {
    if (!this.isRunnableBinary(executable)) return null;
    const inferred = this.inferKind(executable);
    if (inferred === 'pwsh' || inferred === 'windows-powershell') {
      const version = this.probePowerShell(executable);
      return version ? this.toResolved(executable, inferred, version) : null;
    }
    if (inferred === 'zsh' || inferred === 'bash' || inferred === 'sh') {
      const version = this.probePosix(executable, inferred);
      return version ? this.toResolved(executable, inferred, version) : null;
    }
    const powershellVersion = this.probePowerShell(executable);
    if (powershellVersion) {
      return this.toResolved(
        executable,
        this.inferPowerShellKind(executable, powershellVersion),
        powershellVersion,
      );
    }
    const zshVersion = this.probePosix(executable, 'zsh');
    if (zshVersion) return this.toResolved(executable, 'zsh', zshVersion);
    const bashVersion = this.probePosix(executable, 'bash');
    if (bashVersion) return this.toResolved(executable, 'bash', bashVersion);
    const shVersion = this.probePosix(executable, 'sh');
    if (shVersion) return this.toResolved(executable, 'sh', shVersion);
    return null;
  }

  private toResolved(executable: string, kind: ShellKind, version: string): ResolvedShell {
    return {
      executable,
      kind,
      version,
      versionMajor: parseShellVersionMajor(version),
    };
  }

  private isRunnableBinary(executable: string): boolean {
    if (!executable || !this.deps.existsSync(executable)) return false;
    if (isWindowsAppsAliasPath(executable)) return false;
    try {
      return this.deps.statSync(executable).size > 0;
    } catch {
      return false;
    }
  }

  private inferKind(executable: string): ShellKind | null {
    const base = basenameWithoutExt(executable);
    if (base === 'pwsh') return 'pwsh';
    if (base === 'powershell') return 'windows-powershell';
    if (base === 'zsh') return 'zsh';
    if (base === 'bash') return 'bash';
    if (base === 'sh' || base === 'dash') return 'sh';
    return null;
  }

  private inferPowerShellKind(executable: string, version: string): ShellKind {
    if (this.inferKind(executable) === 'pwsh') return 'pwsh';
    const major = parseShellVersionMajor(version);
    return major !== null && major >= 6 ? 'pwsh' : 'windows-powershell';
  }

  private probePowerShell(executable: string): string | null {
    const result = this.deps.spawnSync(
      executable,
      ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_VERSION_COMMAND],
      this.spawnOptions(),
    );
    if (result.status !== 0) return null;
    const version = String(result.stdout ?? '').trim().split(/\r?\n/)[0]?.trim() ?? '';
    return version || null;
  }

  private probePosix(executable: string, kind: 'zsh' | 'bash' | 'sh'): string | null {
    const versionArg = kind === 'zsh'
      ? ['-c', 'printf %s "$ZSH_VERSION"']
      : kind === 'bash'
        ? ['-c', 'printf %s "$BASH_VERSION"']
        : ['-c', 'echo ok'];
    const result = this.deps.spawnSync(executable, versionArg, this.spawnOptions());
    if (result.status !== 0) return null;
    const version = String(result.stdout ?? '').trim().split(/\r?\n/)[0]?.trim() ?? '';
    if (kind === 'sh') return version === 'ok' ? 'sh' : version || 'sh';
    return version || null;
  }

  private spawnOptions(): SpawnSyncOptions {
    return {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
    };
  }
}

export const shellResolver = new ShellResolver();
