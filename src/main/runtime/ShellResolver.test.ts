import { describe, expect, it } from 'vitest';
import type { ShellResolverDeps } from './ShellResolver';
import {
  ShellResolver,
  ShellUnavailableError,
  formatShellDialect,
  formatShellInterpreterLabel,
  isWindowsAppsAliasPath,
} from './ShellResolver';

function createResolver(overrides: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  files?: Record<string, number>;
  probes?: Record<string, { status: number; stdout: string } | ((args: string[]) => { status: number; stdout: string })>;
  where?: string[];
} = {}): ShellResolver {
  const files = overrides.files ?? {};
  const probes = overrides.probes ?? {};
  return new ShellResolver({
    platform: overrides.platform ?? 'win32',
    env: {
      ProgramFiles: 'C:\\Program Files',
      SystemRoot: 'C:\\Windows',
      ...overrides.env,
    },
    homedir: () => 'C:\\Users\\qa',
    existsSync: (filePath) => filePath in files,
    statSync: (filePath) => ({ size: files[filePath] ?? 0 }),
    spawnSync: ((command: string, args?: readonly string[]) => {
      if (String(command).toLowerCase() === 'where.exe') {
        return {
          status: 0,
          stdout: `${(overrides.where ?? []).join('\r\n')}\r\n`,
          stderr: '',
        };
      }
      const argv = [...(args ?? [])].map(String);
      const probe = probes[String(command)];
      if (!probe) {
        return { status: 1, stdout: '', stderr: 'not found' };
      }
      const result = typeof probe === 'function' ? probe(argv) : probe;
      return { status: result.status, stdout: result.stdout, stderr: '' };
    }) as ShellResolverDeps['spawnSync'],
  });
}

describe('isWindowsAppsAliasPath', () => {
  it('rejects Store App Execution Alias locations', () => {
    expect(isWindowsAppsAliasPath('C:\\Users\\qa\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe')).toBe(true);
    expect(isWindowsAppsAliasPath('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe(false);
  });
});

describe('formatShell labels', () => {
  it('labels zsh explicitly and keeps POSIX dialect', () => {
    expect(formatShellInterpreterLabel('zsh')).toBe('zsh');
    expect(formatShellDialect('zsh')).toBe('POSIX sh');
    expect(formatShellInterpreterLabel('bash')).toBe('bash');
    expect(formatShellInterpreterLabel('sh')).toBe('sh');
  });
});

describe('ShellResolver', () => {
  it('prefers a real Program Files pwsh 7 binary over a 0-byte WindowsApps alias', () => {
    const programFiles = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
    const storeAlias = 'C:\\Users\\qa\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe';
    const resolver = createResolver({
      files: {
        [programFiles]: 240_000,
        [storeAlias]: 0,
      },
      where: [storeAlias],
      probes: {
        [programFiles]: { status: 0, stdout: '7.5.1\r\n' },
      },
    });
    expect(resolver.resolve()).toEqual({
      executable: programFiles,
      kind: 'pwsh',
      version: '7.5.1',
      versionMajor: 7,
    });
  });

  it('skips a live-looking WindowsApps path returned by where.exe', () => {
    const storeAlias = 'C:\\Users\\qa\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe';
    const fallback = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
    const resolver = createResolver({
      files: {
        [storeAlias]: 0,
        [fallback]: 400_000,
      },
      where: [storeAlias],
      probes: {
        [fallback]: { status: 0, stdout: '5.1.22621.2506\n' },
      },
    });
    expect(resolver.resolve()).toEqual({
      executable: fallback,
      kind: 'windows-powershell',
      version: '5.1.22621.2506',
      versionMajor: 5,
    });
  });

  it('falls back when a candidate exists but the version probe fails', () => {
    const pwsh = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
    const powershell = 'C:\\Windows\\System32\\powershell.exe';
    const resolver = createResolver({
      files: {
        [pwsh]: 240_000,
        [powershell]: 400_000,
      },
      probes: {
        [pwsh]: { status: 1, stdout: '' },
        [powershell]: { status: 0, stdout: '5.1.19041.1' },
      },
    });
    expect(resolver.resolve().kind).toBe('windows-powershell');
    expect(resolver.resolve().versionMajor).toBe(5);
  });

  it('uses the Settings override when the binary probes cleanly', () => {
    const custom = 'D:\\Tools\\pwsh.exe';
    const resolver = createResolver({
      files: { [custom]: 180_000 },
      probes: { [custom]: { status: 0, stdout: '7.4.6' } },
    });
    expect(resolver.resolve(custom)).toEqual({
      executable: custom,
      kind: 'pwsh',
      version: '7.4.6',
      versionMajor: 7,
    });
  });

  it('fail-closes when the Settings override is a 0-byte alias', () => {
    const storeAlias = 'C:\\Users\\qa\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe';
    const resolver = createResolver({
      files: { [storeAlias]: 0 },
      probes: { [storeAlias]: { status: 0, stdout: '7.5.1' } },
    });
    expect(() => resolver.resolve(storeAlias)).toThrow(ShellUnavailableError);
  });

  it('fail-closes when every candidate is missing or dead', () => {
    const resolver = createResolver({ files: {}, probes: {} });
    expect(() => resolver.resolve()).toThrow(/SHELL_UNAVAILABLE/);
  });

  it('returns POSIX bash when not on Windows', () => {
    const resolver = createResolver({
      platform: 'linux',
      files: { '/bin/bash': 1_200_000 },
      probes: {
        '/bin/bash': { status: 0, stdout: '5.2.21' },
      },
    });
    expect(resolver.resolve()).toEqual({
      executable: '/bin/bash',
      kind: 'bash',
      version: '5.2.21',
      versionMajor: 5,
    });
  });

  it('prefers $SHELL when the basename is zsh', () => {
    const resolver = createResolver({
      platform: 'darwin',
      env: { SHELL: '/bin/zsh' },
      files: {
        '/bin/zsh': 1_000_000,
        '/bin/bash': 1_200_000,
      },
      probes: {
        '/bin/zsh': (args) => {
          expect(args).toEqual(['-c', 'printf %s "$ZSH_VERSION"']);
          return { status: 0, stdout: '5.9' };
        },
        '/bin/bash': { status: 0, stdout: '5.2.21' },
      },
    });
    expect(resolver.resolve()).toEqual({
      executable: '/bin/zsh',
      kind: 'zsh',
      version: '5.9',
      versionMajor: 5,
    });
  });

  it('skips $SHELL when it is fish and continues to bash', () => {
    const resolver = createResolver({
      platform: 'linux',
      env: { SHELL: '/usr/bin/fish' },
      files: {
        '/usr/bin/fish': 800_000,
        '/bin/bash': 1_200_000,
      },
      probes: {
        '/usr/bin/fish': { status: 0, stdout: 'ok' },
        '/bin/bash': { status: 0, stdout: '5.2.21' },
      },
    });
    expect(resolver.resolve()).toMatchObject({
      executable: '/bin/bash',
      kind: 'bash',
    });
  });

  it('fail-closes a fish override instead of probing it as sh', () => {
    const resolver = createResolver({
      platform: 'linux',
      files: { '/usr/bin/fish': 800_000 },
      probes: { '/usr/bin/fish': { status: 0, stdout: 'ok' } },
    });
    expect(() => resolver.resolve('/usr/bin/fish')).toThrow(/POSIX-compatible shell/);
  });

  it('strips profile for agent argv and uses login -lc on POSIX', () => {
    const resolver = createResolver();
    expect(resolver.buildNonInteractiveArgs('pwsh', 'Get-Location')).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from('Get-Location', 'utf16le').toString('base64'),
    ]);
    expect(resolver.buildNonInteractiveArgs('zsh', 'pwd')).toEqual(['-lc', 'pwd']);
    expect(resolver.buildNonInteractiveArgs('bash', 'pwd')).toEqual(['-lc', 'pwd']);
  });
});
