import fs from 'fs';
import path from 'path';

export function resolveRdxBatchInvocation(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== 'win32' || path.basename(command).toLowerCase() !== 'rdx.bat') {
    return { command, args };
  }
  const launcherPath = path.join(path.dirname(command), 'scripts', 'rdx_bat_launcher.ps1');
  if (!fs.existsSync(launcherPath)) {
    return { command, args };
  }
  const psFlags = ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass'];
  if (args[0]?.toLowerCase() === '--non-interactive') {
    psFlags.push('-NonInteractive');
  }
  return {
    command: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: [...psFlags, '-File', launcherPath, ...args],
  };
}
