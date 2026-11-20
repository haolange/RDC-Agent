import { describe, expect, it } from 'vitest';
import { describeHost } from './host';
import {
  defaultPythonCommand,
  defaultShellKind,
  defaultShellLocale,
  requiresCommandInterpreter,
  shellCandidates,
} from './shell';

const windows = describeHost('win32', 'x64');
const linux = describeHost('linux', 'x64');

describe('host interpreter tables', () => {
  it('orders real PowerShell 7 before Windows PowerShell 5.1 on Windows', () => {
    const candidates = shellCandidates({
      host: windows, env: { SystemRoot: 'D:\\Win' }, homedir: 'C:\\Users\\qa', pwshOnPath: ['C:\\tools\\pwsh.exe'], preferredPosix: null,
    });
    expect(candidates.slice(0, 4)).toEqual([
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\tools\\pwsh.exe',
      'C:\\Users\\qa\\.dotnet\\tools\\pwsh.exe',
      'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ]);
  });

  it('puts a validated $SHELL first on POSIX hosts without duplicating it', () => {
    const candidates = shellCandidates({ host: linux, env: {}, homedir: '/home/qa', pwshOnPath: [], preferredPosix: '/bin/bash' });
    expect(candidates).toEqual(['/bin/bash', '/bin/zsh', '/bin/sh', '/usr/bin/zsh', '/usr/bin/bash', '/usr/bin/sh']);
  });

  it('chooses per-host defaults for policy dialect, Python launcher, locale and batch scripts', () => {
    expect([defaultShellKind(windows), defaultShellKind(linux)]).toEqual(['pwsh', 'bash']);
    expect([defaultPythonCommand(windows), defaultPythonCommand(linux)]).toEqual(['python', 'python3']);
    expect([defaultShellLocale(linux), defaultShellLocale(describeHost('darwin', 'arm64'))]).toEqual(['C.UTF-8', 'en_US.UTF-8']);
    expect(requiresCommandInterpreter('C:\\Tools\\run.CMD', windows)).toBe(true);
    expect(requiresCommandInterpreter('/tools/run.cmd', linux)).toBe(false);
  });
});
