/**
 * Host interpreter tables. ShellResolver probes these candidates in order;
 * the tables themselves are the only place that names per-host shells,
 * Python launchers and locale defaults.
 */
import path from 'node:path';
import { currentHost, type HostDescriptor } from './host';

export { windowsPowerShellPath } from './processWin32';

export interface ShellCandidateInput {
  host: HostDescriptor;
  env: NodeJS.ProcessEnv;
  homedir: string;
  /** `pwsh` matches from the Windows PATH lookup, in lookup order. */
  pwshOnPath: readonly string[];
  /** Validated `$SHELL` on POSIX hosts. */
  preferredPosix: string | null;
}

const POSIX_DEFAULT_SHELLS = ['/bin/zsh', '/bin/bash', '/bin/sh', '/usr/bin/zsh', '/usr/bin/bash', '/usr/bin/sh'];

/** Windows: real PowerShell 7, then Windows PowerShell 5.1. POSIX: `$SHELL`, then zsh, bash, sh. */
export function shellCandidates(input: ShellCandidateInput): string[] {
  if (input.host.isWindows) {
    const programFiles = input.env.ProgramFiles || 'C:\\Program Files';
    const systemRoot = input.env.SystemRoot || 'C:\\Windows';
    return [
      path.win32.join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
      ...input.pwshOnPath,
      path.win32.join(input.homedir, '.dotnet', 'tools', 'pwsh.exe'),
      path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      path.win32.join(systemRoot, 'Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      path.win32.join(systemRoot, 'System32', 'powershell.exe'),
      path.win32.join(systemRoot, 'Sysnative', 'powershell.exe'),
      '/bin/bash',
      '/bin/sh',
    ];
  }
  const preferred = input.preferredPosix;
  return preferred ? [preferred, ...POSIX_DEFAULT_SHELLS.filter((entry) => entry !== preferred)] : POSIX_DEFAULT_SHELLS;
}

/** Dialect assumed for command policy when no interpreter could be resolved. */
export function defaultShellKind(host: HostDescriptor = currentHost()): 'pwsh' | 'bash' {
  return host.isWindows ? 'pwsh' : 'bash';
}

/** Python launcher used when the code interpreter command is left empty. */
export function defaultPythonCommand(host: HostDescriptor = currentHost()): 'python' | 'python3' {
  return host.isWindows ? 'python' : 'python3';
}

/** UTF-8 locale for agent shells that inherit no LANG. */
export function defaultShellLocale(host: HostDescriptor = currentHost()): string {
  return host.isMac ? 'en_US.UTF-8' : 'C.UTF-8';
}

/** Windows batch scripts only start through the command interpreter. */
export function requiresCommandInterpreter(command: string, host: HostDescriptor = currentHost()): boolean {
  return host.isWindows && ['.bat', '.cmd'].includes(path.win32.extname(command).toLowerCase());
}
