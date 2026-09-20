import fs from 'fs';
import path from 'path';
import os from 'os';
import type { RdcCliInvokerSettings } from '@shared/types/settings';
import type { RdcInstallationCandidate, RdcInstallationRequest } from '@shared/types/rdcInstallation';
import { assertRdcCliBinding } from '@shared/utils/rdcCliBinding';

/** Only derives a root from the current binding; never guesses a retired layout. */
export function configuredInstallationRoot(settings: RdcCliInvokerSettings): string | null {
  try { assertRdcCliBinding(settings); } catch { return null; }
  return path.resolve(path.dirname(settings.command), '..', '..', '..', '..');
}

export function resolveRdcInstallation(request: RdcInstallationRequest): RdcCliInvokerSettings {
  if (!path.isAbsolute(request.root)) throw new Error('RDC_INSTALLATION_INVALID: select an absolute installation folder.');
  const root = fs.realpathSync(request.root);
  const command = path.join(root, 'binaries', 'windows', 'x64', 'python', 'python.exe');
  const entry = path.join(root, 'cli', 'run_cli.py');
  for (const file of [command, entry]) {
    if (!fs.statSync(file).isFile() || fs.realpathSync(file).toLowerCase() !== file.toLowerCase()) {
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
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidates: RdcInstallationCandidate[] = [
    ...(configured ? [{ root: configured, source: 'configured' as const }] : []),
    { root: path.join(local, 'Programs', 'rdc-tool'), source: 'default' },
  ];
  const seen = new Set<string>();
  return candidates.filter(({ root, source }) => {
    const key = root.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return source === 'configured' || fs.existsSync(root);
  }).map((candidate) => {
    try { resolveRdcInstallation({ root: candidate.root, timeoutMs: settings.timeoutMs, env: settings.env }); return candidate; }
    catch (error) { return { ...candidate, problem: error instanceof Error ? error.message : String(error) }; }
  });
}
