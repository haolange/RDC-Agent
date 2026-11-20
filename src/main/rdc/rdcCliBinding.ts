import {
  RDC_CLI_ENTRY,
  normalizeRdcPath,
  rdcHostLayout,
  rdcLayoutPath,
  rdcPathKey,
  rdcRootFromPython,
  type RdcHostLayout,
} from '../platform/rdcLayout';
import type { RdcCliInvokerSettings } from '@shared/types/settings';

function resolveBindingPath(value: string, base: string, layout: RdcHostLayout): string | null {
  const absolute = normalizeRdcPath(value, layout);
  if (absolute) return absolute;
  if (!value || value.includes('"') || value.includes(String.fromCharCode(0))) return null;
  const normalizedBase = normalizeRdcPath(base, layout);
  if (!normalizedBase) return null;
  return normalizeRdcPath(`${normalizedBase}/${value}`, layout);
}

/**
 * Structural validation shared by Settings and the native invocation boundary.
 * Returns the installation root (normalized `/` form) derived from the host layout.
 */
export function assertRdcCliBinding(settings: RdcCliInvokerSettings, layout: RdcHostLayout = rdcHostLayout()): string {
  const { command, argsPrefix, env } = settings;
  const parts = [command, ...argsPrefix];
  if (parts.some(value => /\.bat$/i.test(value.trim()) || /rdc_bat_launcher\.ps1/i.test(value))) {
    throw new Error('RDC_BAT_REJECTED: configure the bundled Python and cli/run_cli.py.');
  }
  const root = rdcRootFromPython(command, layout);
  if (!root) {
    throw new Error(`RDC_BINDING_INVALID: command must be the absolute bundled ${layout.runtimeDir}/${layout.pythonExecutable} path.`);
  }
  if (rdcPathKey(root, layout).split('/').includes('rdx-tools')) {
    throw new Error('RDC_BINDING_INVALID: retired installation layout; install RDC-Tool in rdc-tool and select its bundled Python.');
  }
  const entry = argsPrefix[0] ?? '';
  const resolvedEntry = resolveBindingPath(entry, settings.workingDirectory || root, layout);
  const expectedEntry = rdcPathKey(rdcLayoutPath(root, RDC_CLI_ENTRY, layout), layout);
  if (argsPrefix.length !== 1 || !resolvedEntry || rdcPathKey(resolvedEntry, layout) !== expectedEntry) {
    throw new Error('RDC_BINDING_INVALID: argsPrefix must contain only cli/run_cli.py from the same installation.');
  }
  for (const [key, value] of Object.entries(env)) {
    const name = key.toUpperCase();
    if (name.startsWith('RDX_')) {
      throw new Error('RDC_BINDING_INVALID: retired environment variable; use RDC_TOOL_* (RDC_TOOL_INTERMEDIATE_ROOT for temporary data).');
    }
    if (['PYTHONHOME', 'PYTHONPATH'].includes(name) && value.trim()) {
      throw new Error('RDC_BINDING_INVALID: environment must not redirect the bundled Python.');
    }
  }
  return root;
}
