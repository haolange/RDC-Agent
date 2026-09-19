import type { RdxCliInvokerSettings } from '../types/settings';

function absoluteWindowsPath(value: string): string | null {
  const text = value.replace(/\//g, '\\');
  const root = /^([a-z]:\\|\\\\[^\\]+\\[^\\]+\\)/i.exec(text)?.[0];
  if (!root || (text.includes('"') || text.includes(String.fromCharCode(0)))) return null;
  const parts: string[] = [];
  for (const part of text.slice(root.length).split('\\')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else parts.push(part);
  }
  return (root + parts.join('\\')).toLowerCase();
}

/** Structural validation shared by Settings and the native invocation boundary. */
export function assertRdxCliBinding(settings: RdxCliInvokerSettings): void {
  const { command, argsPrefix, env } = settings;
  const parts = [command, ...argsPrefix];
  if (parts.some(value => /\.bat$/i.test(value.trim()) || /rdx_bat_launcher\.ps1/i.test(value))) {
    throw new Error('RDX_BAT_REJECTED: configure bundled python.exe and cli/run_cli.py.');
  }
  const normalized = absoluteWindowsPath(command);
  const suffix = '\\binaries\\windows\\x64\\python\\python.exe';
  if (!normalized?.endsWith(suffix)) {
    throw new Error('RDX_BINDING_INVALID: command must be the absolute bundled binaries/windows/x64/python/python.exe path.');
  }
  const root = normalized.slice(0, -suffix.length);
  const entry = argsPrefix[0] ?? '';
  const resolvedEntry = absoluteWindowsPath(entry)
    ?? absoluteWindowsPath(`${settings.workingDirectory || root}\\${entry}`);
  if (argsPrefix.length !== 1 || resolvedEntry !== `${root}\\cli\\run_cli.py`) {
    throw new Error('RDX_BINDING_INVALID: argsPrefix must contain only cli/run_cli.py from the same installation.');
  }
  for (const [key, value] of Object.entries(env)) {
    const name = key.toUpperCase();
    if ((name === 'RDX_TOOLS_ROOT' && absoluteWindowsPath(value) !== root)
      || (['PYTHONHOME', 'PYTHONPATH'].includes(name) && value.trim())) {
      throw new Error('RDX_BINDING_INVALID: environment must not redirect the Python or Tools installation.');
    }
  }
}
