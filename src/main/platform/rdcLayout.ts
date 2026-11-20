/**
 * RDC-Tool installation layout per host. Mirrors HOST_LAYOUTS in RDC-Tool
 * `rdc_tool/runtime_paths.py`: the runtime directory below the installation
 * root and the bundled Python, native library and binding below it. The
 * installation root is always derived by removing the host layout suffix from
 * the bundled Python path; the CLI entry is `<root>/cli/run_cli.py`.
 */
import os from 'node:os';
import path from 'node:path';
import { currentHost, type HostDescriptor } from './host';

export interface RdcHostLayout {
  readonly target: 'windows-x64' | 'linux-x64';
  /** Runtime directory below the installation root. */
  readonly runtimeDir: string;
  /** Bundled Python executable below runtimeDir. */
  readonly pythonExecutable: string;
  /** RenderDoc native library below runtimeDir. */
  readonly nativeLibrary: string;
  /** RenderDoc Python binding below runtimeDir. */
  readonly bindingModule: string;
  /** Windows path syntax, compared case-insensitively. */
  readonly windowsPaths: boolean;
}

export const RDC_HOST_LAYOUTS: Readonly<Record<RdcHostLayout['target'], RdcHostLayout>> = Object.freeze({
  'windows-x64': Object.freeze({
    target: 'windows-x64',
    runtimeDir: 'binaries/windows/x64',
    pythonExecutable: 'python/python.exe',
    nativeLibrary: 'renderdoc.dll',
    bindingModule: 'pymodules/renderdoc.pyd',
    windowsPaths: true,
  }),
  'linux-x64': Object.freeze({
    target: 'linux-x64',
    runtimeDir: 'binaries/linux/x64',
    pythonExecutable: 'python/bin/python3.14',
    nativeLibrary: 'lib/librenderdoc.so',
    bindingModule: 'pymodules/renderdoc.so',
    windowsPaths: false,
  }),
});

export const RDC_CLI_ENTRY = 'cli/run_cli.py';

export function rdcHostLayout(host: HostDescriptor = currentHost()): RdcHostLayout {
  const layout = (RDC_HOST_LAYOUTS as Readonly<Record<string, RdcHostLayout | undefined>>)[host.target];
  if (!layout) {
    throw new Error(`RDC_HOST_UNSUPPORTED: RDC-Tool has no runtime layout for host ${host.target}; supported: ${Object.keys(RDC_HOST_LAYOUTS).join(', ')}.`);
  }
  return layout;
}

function pathApi(layout: RdcHostLayout): path.PlatformPath {
  return layout.windowsPaths ? path.win32 : path.posix;
}

/** Absolute path in `/` form for the layout's host syntax, or null when not a usable absolute path. */
export function normalizeRdcPath(value: string, layout: RdcHostLayout): string | null {
  const text = value.trim();
  if (!text || text.includes('"') || text.includes(String.fromCharCode(0))) return null;
  if (!pathApi(layout).isAbsolute(text)) return null;
  return layout.windowsPaths ? path.win32.normalize(text).replace(/\\/g, '/') : path.posix.normalize(text);
}

/** Comparison key of a normalized path: case-insensitive only for Windows layouts. */
export function rdcPathKey(normalized: string, layout: RdcHostLayout): string {
  return layout.windowsPaths ? normalized.toLowerCase() : normalized;
}

/** `relative` below a normalized `root`, in normalized `/` form. */
export function rdcLayoutPath(root: string, relative: string, layout: RdcHostLayout): string {
  const joined = pathApi(layout).join(root, relative);
  return layout.windowsPaths ? joined.replace(/\\/g, '/') : joined;
}

/** Installation root of the layout's bundled Python, or null when `command` is not that path. */
export function rdcRootFromPython(command: string, layout: RdcHostLayout): string | null {
  const normalized = normalizeRdcPath(command, layout);
  const suffix = `/${layout.runtimeDir}/${layout.pythonExecutable}`;
  if (!normalized || !rdcPathKey(normalized, layout).endsWith(rdcPathKey(suffix, layout))) return null;
  const root = normalized.slice(0, -suffix.length);
  if (!root) return '/';
  return layout.windowsPaths && /^[a-z]:$/i.test(root) ? `${root}/` : root;
}

/** Host-native paths of an installation's runtime directory, bundled Python and CLI entry. */
export function rdcInstallationFiles(root: string, layout: RdcHostLayout = rdcHostLayout()) {
  const api = pathApi(layout);
  const runtimeDir = api.join(root, ...layout.runtimeDir.split('/'));
  return {
    runtimeDir,
    python: api.join(runtimeDir, ...layout.pythonExecutable.split('/')),
    nativeLibrary: api.join(runtimeDir, ...layout.nativeLibrary.split('/')),
    bindingModule: api.join(runtimeDir, ...layout.bindingModule.split('/')),
    entry: api.join(root, ...RDC_CLI_ENTRY.split('/')),
  };
}

/** Installer default roots checked by detection; RDC-Tool ships an installer only for Windows. */
export function rdcDefaultInstallationRoots(host: HostDescriptor = currentHost()): string[] {
  if (!host.isWindows) return [];
  const localAppData = process.env.LOCALAPPDATA || path.win32.join(os.homedir(), 'AppData', 'Local');
  return [path.win32.join(localAppData, 'Programs', 'rdc-tool')];
}
