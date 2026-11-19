import fs from 'fs';
import path from 'path';
import { resolvedPathKey, samePath } from '../platform/paths';
import { rdcDefaultInstallationRoots, rdcHostLayout, rdcInstallationFiles, rdcRootFromPython } from '../platform/rdcLayout';
import { assertRdcCliBinding } from './rdcCliBinding';
import type { RdcInstallationCandidate, RdcInstallationRequest } from '@shared/types/rdcInstallation';
import type { RdcCliInvokerSettings } from '@shared/types/settings';

/** Only derives a root from the current binding; never guesses a retired layout. */
export function configuredInstallationRoot(settings: RdcCliInvokerSettings): string | null {
  try { return path.resolve(assertRdcCliBinding(settings)); } catch { return null; }
}

/** Installation root of a recorded bundled Python path for this host layout. */
export function installationRootOfPython(command: string): string {
  const layout = rdcHostLayout();
  const root = rdcRootFromPython(command, layout);
  if (!root) {
    throw new Error(`RDC_INSTALLATION_INVALID: ${command} is not the bundled ${layout.runtimeDir}/${layout.pythonExecutable} of an installation.`);
  }
  return path.resolve(root);
}

export function resolveRdcInstallation(request: RdcInstallationRequest): RdcCliInvokerSettings {
  if (!path.isAbsolute(request.root)) throw new Error('RDC_INSTALLATION_INVALID: select an absolute installation folder.');
  const root = fs.realpathSync(request.root);
  const { python: command, entry } = rdcInstallationFiles(root);
  for (const file of [command, entry]) {
    if (!fs.statSync(file).isFile() || !samePath(fs.realpathSync(file), file)) {
      throw new Error('RDC_INSTALLATION_INVALID: Python and CLI must be regular files in the same installation.');
    }
  }
  const settings: RdcCliInvokerSettings = {
    enabled: true, command, argsPrefix: [entry], workingDirectory: root,
    timeoutMs: request.timeoutMs, env: { ...request.env },
  };
  assertRdcCliBinding(settings);
  return settings;
}

/** Discovery reads files only. The explicit verification action is the first execution. */
export function detectRdcInstallations(settings: RdcCliInvokerSettings): RdcInstallationCandidate[] {
  const configured = configuredInstallationRoot(settings);
  const candidates: RdcInstallationCandidate[] = [
    ...(configured ? [{ root: configured, source: 'configured' as const }] : []),
    ...rdcDefaultInstallationRoots().map((root) => ({ root, source: 'default' as const })),
  ];
  const seen = new Set<string>();
  return candidates.filter(({ root, source }) => {
    const key = resolvedPathKey(root);
    if (seen.has(key)) return false;
    seen.add(key);
    return source === 'configured' || fs.existsSync(root);
  }).map((candidate) => {
    try { resolveRdcInstallation({ root: candidate.root, timeoutMs: settings.timeoutMs, env: settings.env }); return candidate; }
    catch (error) { return { ...candidate, problem: error instanceof Error ? error.message : String(error) }; }
  });
}
