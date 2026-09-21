import path from 'path';
import { randomUUID } from 'crypto';
import type { ShellKind } from '../../../runtime/ShellResolver';

export interface ShellTrailerState {
  cwd: string;
  provider: string;
  exit: number;
}

export interface ParsedShellOutput {
  body: string;
  trailer: ShellTrailerState | null;
}

export function createShellTrailerMarker(): string {
  return `RDC_SHELL_${randomUUID().replace(/-/g, '')}`;
}

export function createShellBeginMarker(marker: string): string {
  return `${marker}_BEGIN`;
}

export function quotePosixSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildAgentShellEnv(
  base: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env = { ...base };
  if (!env.LANG) {
    env.LANG = platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8';
  }
  return env;
}

export function wrapShellCommand(
  command: string,
  kind: ShellKind,
  marker: string,
  options: { scriptPath?: string; spawnCwd?: string } = {},
): string {
  if (kind === 'pwsh' || kind === 'windows-powershell') {
    return wrapPowerShellCommand(command, marker);
  }
  if (!options.scriptPath || !options.spawnCwd) {
    throw new Error('POSIX shell wrapper requires scriptPath and spawnCwd');
  }
  return wrapPosixCommand(options.scriptPath, marker, options.spawnCwd);
}

export function wrapPowerShellCommand(command: string, marker: string): string {
  const encoded = Buffer.from(command, 'utf8').toString('base64');
  return [
    'try { $PSNativeCommandUseErrorActionPreference = $false } catch { }',
    // Keep PowerShell's native decoder aligned with the inherited console/OEM code page.
    // Only our own writer is UTF-8; forcing Console.OutputEncoding corrupts legacy native output.
    '$__stdout = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), (New-Object System.Text.UTF8Encoding $false))',
    '$__stdout.AutoFlush = $true',
    'function Write-RdcLine([string]$Line) { $__stdout.WriteLine($Line) }',
    "$ErrorActionPreference = 'Stop'",
    `$__m = '${marker}'`,
    '$__exit = 0',
    '$__errFile = [System.IO.Path]::GetTempFileName()',
    'try {',
    `  $__src = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`,
    '  & ([scriptblock]::Create($__src)) 2>$__errFile | ForEach-Object { Write-RdcLine (($_ | Out-String).TrimEnd()) }',
    '  if ($null -ne $LASTEXITCODE) { $__exit = [int]$LASTEXITCODE }',
    '  if (Test-Path -LiteralPath $__errFile) {',
    '    $__bytes = [System.IO.File]::ReadAllBytes($__errFile)',
    '    if ($__bytes.Length -gt 0) {',
    '      $__enc = if ($PSVersionTable.PSVersion.Major -ge 6) { New-Object System.Text.UTF8Encoding $false } else { [System.Text.Encoding]::Default }',
    '      $__errText = $__enc.GetString($__bytes).TrimEnd()',
    '      if ($__errText) { Write-RdcLine $__errText }',
    '    }',
    '  }',
    '} catch {',
    '  $__exit = 1',
    '  Write-RdcLine (($_ | Out-String).TrimEnd())',
    '} finally {',
    '  Remove-Item -LiteralPath $__errFile -Force -ErrorAction SilentlyContinue',
    '  $__loc = Get-Location',
    '  $__provider = $__loc.Provider.Name',
    "  $__cwd = if ($__provider -eq 'FileSystem') { $__loc.ProviderPath } else { '' }",
    '  Write-RdcLine ""',
    '  Write-RdcLine $__m',
    '  Write-RdcLine ("cwd=" + $__cwd)',
    '  Write-RdcLine ("provider=" + $__provider)',
    '  Write-RdcLine ("exit=" + $__exit)',
    '  $__stdout.Flush()',
    '}',
    '[Environment]::Exit($__exit)',
  ].join('\n');
}

export function wrapPosixCommand(scriptPath: string, marker: string, spawnCwd: string): string {
  const begin = createShellBeginMarker(marker);
  const quotedScript = quotePosixSingle(scriptPath);
  const quotedCwd = quotePosixSingle(spawnCwd);
  return [
    `__m='${marker}'`,
    `__begin='${begin}'`,
    'printf \'%s\\n\' "$__begin"',
    `cd ${quotedCwd}`,
    '__exit=0',
    '__emitted=0',
    '__emit() {',
    '  if [ "$__emitted" -eq 1 ]; then return; fi',
    '  __emitted=1',
    '  __cwd=$(pwd -P 2>/dev/null || pwd)',
    '  printf \'\\n%s\\ncwd=%s\\nprovider=FileSystem\\nexit=%s\\n\' "$__m" "$__cwd" "$__exit"',
    `  rm -f -- ${quotedScript}`,
    '}',
    'trap \'__exit=$?; __emit\' EXIT',
    'set +e',
    `. ${quotedScript}`,
    '__exit=$?',
    '__emit',
    'exit "$__exit"',
  ].join('\n');
}

export function parseShellTrailer(stdout: string, marker: string): ParsedShellOutput {
  const normalized = stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const begin = createShellBeginMarker(marker);
  const beginToken = `\n${begin}\n`;
  let payload = normalized;
  const beginIndex = normalized.indexOf(beginToken);
  if (beginIndex >= 0) {
    payload = normalized.slice(beginIndex + beginToken.length);
  } else if (normalized.startsWith(`${begin}\n`)) {
    payload = normalized.slice(begin.length + 1);
  }

  const token = `\n${marker}\n`;
  let index = payload.lastIndexOf(token);
  let bodyStart = 0;
  if (index < 0 && payload.startsWith(`${marker}\n`)) {
    index = 0;
    bodyStart = -1;
  }
  if (index < 0) {
    return { body: payload, trailer: null };
  }
  const body = bodyStart < 0 ? '' : payload.slice(0, index).replace(/\s+$/u, '');
  const tail = bodyStart < 0 ? payload.slice(marker.length + 1) : payload.slice(index + token.length);
  const fields: Record<string, string> = {};
  for (const line of tail.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    fields[line.slice(0, separator)] = line.slice(separator + 1);
  }
  const exit = Number.parseInt(fields.exit ?? '', 10);
  return {
    body,
    trailer: {
      cwd: fields.cwd ?? '',
      provider: fields.provider ?? '',
      exit: Number.isFinite(exit) ? exit : 0,
    },
  };
}

export function isPathInsideRoot(target: string, root: string): boolean {
  const isWindowsPath = (value: string): boolean => /^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value);
  const targetIsWindows = isWindowsPath(target);
  const rootIsWindows = isWindowsPath(root);
  if (targetIsWindows !== rootIsWindows) return false;
  const pathApi = targetIsWindows ? path.win32 : path.posix;
  const resolvedTarget = pathApi.resolve(target);
  const resolvedRoot = pathApi.resolve(root);
  const relative = pathApi.relative(resolvedRoot, resolvedTarget);
  return relative === '' || (!relative.startsWith('..') && !pathApi.isAbsolute(relative));
}
