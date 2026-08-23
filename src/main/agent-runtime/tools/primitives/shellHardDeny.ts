/**
 * Catastrophic shell patterns hard-denied in every permission mode, including
 * full-access. Patterns are classified after static alias expansion and
 * shortest-unique parameter binding. Never call Get-Alias at runtime.
 */

import type { ShellKind } from '../../../runtime/ShellResolver';

const POWERSHELL_ALIASES: Record<string, string> = {
  ri: 'Remove-Item',
  rm: 'Remove-Item',
  del: 'Remove-Item',
  erase: 'Remove-Item',
  rd: 'Remove-Item',
  rmdir: 'Remove-Item',
  iwr: 'Invoke-WebRequest',
  irm: 'Invoke-RestMethod',
  curl: 'Invoke-WebRequest',
  wget: 'Invoke-WebRequest',
  iex: 'Invoke-Expression',
  sl: 'Set-Location',
  cd: 'Set-Location',
  chdir: 'Set-Location',
  saps: 'Start-Process',
  start: 'Start-Process',
};

const REMOVE_ITEM_PARAMS = ['Recurse', 'Force', 'Path', 'LiteralPath', 'Filter', 'Include', 'Exclude'];
const START_PROCESS_PARAMS = ['Verb', 'FilePath', 'ArgumentList', 'WorkingDirectory', 'Wait', 'PassThru'];
const DOWNLOAD_LEFT = new Set(['invoke-webrequest', 'invoke-restmethod']);
const DOWNLOAD_RIGHT = new Set([
  'invoke-expression',
  'bash',
  'sh',
  'pwsh',
  'powershell',
  'cmd',
]);
const NESTED_LAUNCHERS = new Set(['powershell', 'pwsh', 'cmd']);
const REGISTRY_HIVES = new Set(['hklm', 'hkcu', 'hkcr', 'hku', 'hkcc']);
const MAX_NESTED_LAUNCHER_DEPTH = 2;

export function splitShellSegments(command: string): string[] {
  return command
    .split(/(?:&&|\|\||[;&\n]|\|(?!\|))/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function foldPowerShellEscapes(segment: string): string {
  let folded = '';
  for (let index = 0; index < segment.length; index += 1) {
    if (segment[index] === '`' && index + 1 < segment.length) {
      folded += segment[index + 1];
      index += 1;
      continue;
    }
    folded += segment[index];
  }
  return folded;
}

export function tokenizeQuoted(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const ch of foldPowerShellEscapes(segment)) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens.filter((token) => token !== '&' && token !== '&&');
}

export function normalizeCommandToken(token: string): string {
  let value = token.trim().replace(/^&+/, '');
  value = value.replace(/^['"]|['"]$/g, '');
  value = value.replace(/\.exe$/i, '');
  return value.split(/[/\\]/).filter(Boolean).pop() ?? value;
}

export function expandPowerShellAlias(token: string): string {
  return POWERSHELL_ALIASES[token.toLowerCase()] ?? token;
}

export function bindNamedParameter(arg: string, candidates: string[]): string | null {
  if (!arg.startsWith('-')) return null;
  const name = arg.replace(/^-+/, '').toLowerCase();
  if (!name) return null;
  const exact = candidates.find((candidate) => candidate.toLowerCase() === name);
  if (exact) return exact;
  const matches = candidates.filter((candidate) => candidate.toLowerCase().startsWith(name));
  return matches.length === 1 ? matches[0] : null;
}

function isEncodedCommandSwitch(arg: string): boolean {
  if (!arg.startsWith('-')) return false;
  const name = arg.replace(/^-+/, '').toLowerCase();
  return name === 'e' || name === 'ec' || name.startsWith('enc') || name === 'encodedcommand';
}

function isUnixStyleRecurseForce(arg: string): boolean {
  return /^-[a-z]*r[a-z]*f\b/i.test(arg) || /^-[a-z]*f[a-z]*r\b/i.test(arg);
}

function switchName(arg: string): string {
  return arg.replace(/^[-/]+/, '').toLowerCase();
}

function isLauncherCommandSwitch(arg: string, launcher: string): boolean {
  const name = switchName(arg);
  if (launcher === 'cmd') return name === 'c' || name === 'k';
  return name === 'c' || name === 'command' || name.startsWith('command');
}

function isExecutionPolicySwitch(arg: string): boolean {
  if (!arg.startsWith('-')) return false;
  const name = switchName(arg);
  return name === 'ep' || name === 'executionpolicy' || name.startsWith('execution');
}

function extractLauncherCommand(tokens: string[], launcher: string): string | null {
  for (let index = 1; index < tokens.length; index += 1) {
    if (!isLauncherCommandSwitch(tokens[index]!, launcher)) continue;
    return tokens[index + 1] ?? null;
  }
  return null;
}

export function isRootOrHivePath(value: string): boolean {
  const normalized = value.trim().replace(/^['"]|['"]$/g, '');
  if (!normalized) return false;
  if (/^[A-Za-z]:[\\/]?$/.test(normalized)) return true;
  if (normalized === '/' || normalized === '\\') return true;
  if (/^\\\\\?\\[A-Za-z]:[\\/]?$/.test(normalized)) return true;
  if (/^\\\\[^\\/]+\\[^\\/]+[\\/]?$/.test(normalized)) return true;
  const hive = normalized.match(/^([A-Za-z]+):\\?$/);
  if (hive && REGISTRY_HIVES.has(hive[1]!.toLowerCase())) return true;
  if (/^%SYSTEMDRIVE%\\?$/i.test(normalized)) return true;
  if (/^\$env:SystemDrive\\?$/i.test(normalized)) return true;
  if (/^\$\{env:SystemDrive\}\\?$/i.test(normalized)) return true;
  return false;
}

function commandNameOf(tokens: string[]): string {
  const raw = normalizeCommandToken(tokens[0] ?? '');
  return expandPowerShellAlias(raw);
}

function matchDownloadPipe(command: string): string | null {
  const pipeParts = command.split('|').map((part) => part.trim()).filter(Boolean);
  for (let index = 0; index < pipeParts.length - 1; index += 1) {
    const left = commandNameOf(tokenizeQuoted(pipeParts[index]!)).toLowerCase();
    const right = commandNameOf(tokenizeQuoted(pipeParts[index + 1]!)).toLowerCase();
    if (DOWNLOAD_LEFT.has(left) && DOWNLOAD_RIGHT.has(right)) {
      return 'iwr | iex';
    }
  }
  return null;
}

function matchPosixCatastrophicPatterns(command: string): string | null {
  const patterns: Array<[RegExp, string]> = [
    [/\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+(\/\s*$|\/\*|~|\$HOME)/i, 'rm -rf /'],
    [/\bdd\s+if=/i, 'dd if='],
    [/>\s*\/dev\/(sd|hd|nvme|xvd)/i, '> /dev/'],
    [/\bchmod\s+777\b/i, 'chmod 777'],
    [/:\(\)\s*\{/, ':(){ :|:& };:'],
  ];
  for (const [pattern, label] of patterns) {
    if (pattern.test(command)) return label;
  }
  return null;
}

function matchNestedCommand(nested: string, depth: number): string | null {
  return matchPowerShellHardDeny(nested, depth)
    ?? matchWindowsCmdHardDeny(nested)
    ?? matchPosixHardDeny(nested);
}

function matchPowerShellHardDeny(command: string, depth = 0): string | null {
  if (/\bvssadmin\b/i.test(command) && /\bdelete\b/i.test(command) && /\bshadows?\b/i.test(command)) {
    return 'vssadmin delete shadows';
  }
  if (/\bicacls\b/i.test(command) && /\s\/grant\b/i.test(command) && /\bicacls\s+(?:[A-Za-z]:\\?|\/)\s+\/grant/i.test(command)) {
    return 'icacls /grant';
  }

  const downloadDeny = matchDownloadPipe(command);
  if (downloadDeny) return downloadDeny;

  for (const segment of splitShellSegments(command)) {
    const tokens = tokenizeQuoted(segment);
    if (tokens.length === 0) continue;
    const commandName = commandNameOf(tokens);
    const commandLower = commandName.toLowerCase();
    const args = tokens.slice(1);

    if (tokens.some((token) => isEncodedCommandSwitch(token))) {
      return '-EncodedCommand';
    }

    if (NESTED_LAUNCHERS.has(commandLower)) {
      if (tokens.some((token, index) => (
        isExecutionPolicySwitch(token)
        && /^bypass$/i.test((tokens[index + 1] ?? '').replace(/^['"]|['"]$/g, ''))
      ))) {
        return 'Set-ExecutionPolicy Bypass';
      }
      if (depth < MAX_NESTED_LAUNCHER_DEPTH) {
        const nested = extractLauncherCommand(tokens, commandLower);
        if (nested) {
          const inner = matchNestedCommand(nested, depth + 1);
          if (inner) return inner;
        }
      }
    }

    if (commandLower === 'invoke-expression') {
      if (args.some((arg) => arg.startsWith('$'))) {
        return 'Invoke-Expression $var';
      }
      if (depth < MAX_NESTED_LAUNCHER_DEPTH) {
        for (const arg of args) {
          if (arg.startsWith('-')) continue;
          const inner = matchNestedCommand(arg, depth + 1);
          if (inner) return inner;
        }
      }
    }

    if (commandLower === 'remove-item') {
      const switches = args.flatMap((arg) => {
        if (isUnixStyleRecurseForce(arg)) return ['Recurse', 'Force'];
        const bound = bindNamedParameter(arg, REMOVE_ITEM_PARAMS);
        return bound ? [bound] : [];
      });
      const paths = args.filter((arg) => !arg.startsWith('-'));
      if (switches.includes('Recurse') && switches.includes('Force') && paths.some(isRootOrHivePath)) {
        return 'Remove-Item -Recurse -Force';
      }
    }

    if (commandLower === 'format-volume' || commandLower === 'format') return 'Format-Volume';
    if (commandLower === 'clear-disk') return 'Clear-Disk';
    if (commandLower === 'stop-computer') return 'Stop-Computer';
    if (commandLower === 'restart-computer') return 'Restart-Computer';
    if (commandLower === 'diskpart') return 'diskpart';

    if (commandLower === 'start-process') {
      const verbIndex = args.findIndex((arg) => bindNamedParameter(arg, START_PROCESS_PARAMS) === 'Verb');
      const verb = (args[verbIndex + 1] ?? '').replace(/^['"]|['"]$/g, '');
      if (verbIndex >= 0 && /^runas$/i.test(verb)) {
        return 'Start-Process -Verb RunAs';
      }
    }

    if (commandLower === 'set-executionpolicy') {
      const values = args.map((arg) => arg.replace(/^['"]|['"]$/g, '').toLowerCase());
      if (values.includes('bypass')) return 'Set-ExecutionPolicy Bypass';
    }
  }

  return null;
}

function matchWindowsCmdHardDeny(command: string): string | null {
  const lowered = command.toLowerCase();
  if (/\brd\b/.test(lowered) && /\/s\b/.test(lowered) && /\/q\b/.test(lowered)) return 'rd /s /q';
  if (/\bdel\b/.test(lowered) && /\/s\b/.test(lowered) && /\/q\b/.test(lowered)) return 'del /s /q';
  if (/\bdiskpart\b/.test(lowered)) return 'diskpart';
  if (/\bshutdown\b/.test(lowered) && /\/s\b/.test(lowered)) return 'shutdown /s';
  for (const segment of splitShellSegments(command)) {
    const token = normalizeCommandToken(tokenizeQuoted(segment)[0] ?? '').toLowerCase();
    if (token === 'format') return 'format';
  }
  return null;
}

function matchPosixHardDeny(command: string): string | null {
  const patterned = matchPosixCatastrophicPatterns(command);
  if (patterned) return patterned;
  const firstTokens = new Set(['mkfs', 'shutdown', 'reboot']);
  for (const segment of splitShellSegments(command)) {
    const tokens = tokenizeQuoted(segment);
    const token = normalizeCommandToken(tokens[0] ?? '').toLowerCase();
    if (token === 'sudo') {
      const rest = tokens.slice(1).join(' ');
      const nested = matchPosixCatastrophicPatterns(rest)
        ?? (normalizeCommandToken(tokens[1] ?? '').toLowerCase().startsWith('mkfs') ? 'mkfs' : null);
      if (nested) return `sudo ${nested}`;
      continue;
    }
    if (firstTokens.has(token) || token.startsWith('mkfs.')) {
      return token.startsWith('mkfs') ? 'mkfs' : token;
    }
  }
  return null;
}

export function matchShellHardDeny(command: string, kind?: ShellKind | 'cmd'): string | null {
  const text = String(command ?? '');
  if (!text.trim()) return null;
  const resolved = kind ?? (process.platform === 'win32' ? 'pwsh' : 'bash');
  if (resolved === 'pwsh' || resolved === 'windows-powershell') {
    return matchPowerShellHardDeny(text) ?? matchWindowsCmdHardDeny(text) ?? matchPosixHardDeny(text);
  }
  if (resolved === 'cmd') {
    return matchWindowsCmdHardDeny(text);
  }
  return matchPosixHardDeny(text);
}
