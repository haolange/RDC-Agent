import type { RdcCliInvokerSettings } from '../types/settings';

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
export function assertRdcCliBinding(settings: RdcCliInvokerSettings): void {
  const { command, argsPrefix, env } = settings;
  const parts = [command, ...argsPrefix];
  if (parts.some(value => /\.bat$/i.test(value.trim()) || /rdc_bat_launcher\.ps1/i.test(value))) {
    throw new Error('RDC_BAT_REJECTED: configure bundled python.exe and cli/run_cli.py.');
  }
  const normalized = absoluteWindowsPath(command);
  const suffix = '\\binaries\\windows\\x64\\python\\python.exe';
  if (!normalized?.endsWith(suffix)) {
    throw new Error('RDC_BINDING_INVALID: command must be the absolute bundled binaries/windows/x64/python/python.exe path.');
  }
  const root = normalized.slice(0, -suffix.length);
  if (root.split('\\').includes('rdx-tools')) {
    throw new Error('RDC_BINDING_INVALID: retired installation layout; install RDC-Tool in rdc-tool and select its bundled Python.');
  }
  const entry = argsPrefix[0] ?? '';
  const resolvedEntry = absoluteWindowsPath(entry)
    ?? absoluteWindowsPath(`${settings.workingDirectory || root}\\${entry}`);
  if (argsPrefix.length !== 1 || resolvedEntry !== `${root}\\cli\\run_cli.py`) {
    throw new Error('RDC_BINDING_INVALID: argsPrefix must contain only cli/run_cli.py from the same installation.');
  }
  for (const [key, value] of Object.entries(env)) {
    const name = key.toUpperCase();
    if (name.startsWith('RDX_')) {
      throw new Error('RDC_BINDING_INVALID: retired environment variable; use RDC_TOOL_* (RDC_TOOL_INTERMEDIATE_ROOT for temporary data).');
    }
    if ((name === 'RDC_TOOL_ROOT' && absoluteWindowsPath(value) !== root)
      || (['PYTHONHOME', 'PYTHONPATH'].includes(name) && value.trim())) {
      throw new Error('RDC_BINDING_INVALID: environment must not redirect the Python or Tools installation.');
    }
  }
}
