import path from 'node:path';
import { appPathService } from '../../runtime/AppPathService';

const normalize = (target: string) => path.resolve(target).replace(/\\/g, '/').toLowerCase();
const within = (target: string, root: string) => target === root || target.startsWith(`${root}/`);

/**
 * Files the application owns and no tool may write in any permission mode: credentials, the audit log, trust records,
 * settings and session state. Writing them would forge history or widen the agent's own authority. Run artifacts under
 * a session are the one part of application state a tool produces.
 */
function applicationOwnedReason(target: string, name: string): string | null {
  const state = appPathService.getAppStatePaths();
  const user = appPathService.getUserRdcPaths();
  const stateRoot = normalize(state.appStateRoot);
  const userRoot = normalize(user.userRdcRoot);
  if (within(target, normalize(state.secretsPath)) || within(target, `${userRoot}/secrets`)) {
    return 'Credentials are written only by the application.';
  }
  if (target === normalize(user.configPath)) return 'Settings are written only through Settings.';
  if (name.endsWith('-trust.json') && (within(target, stateRoot) || within(target, userRoot))) {
    return 'Trust records are written only by the person granting trust.';
  }
  if (within(target, stateRoot)) {
    const relative = target.slice(stateRoot.length + 1).split('/');
    if (!(relative[0] === 'sessions' && relative.includes('artifacts'))) {
      return 'Audit records and session state are written only by the application.';
    }
  }
  return null;
}

/** Canonical path policy shared by file approval and RDC artifact writes. */
export function fileOperationBoundary(target: string): { readOnly: boolean; protected: boolean; reason: string } {
  const normalized = normalize(target);
  const parts = normalized.split('/');
  const name = parts.at(-1) ?? '';
  const scope = parts.lastIndexOf('.rdc-agent');
  const category = scope >= 0 ? parts[scope + 1] : '';
  const applicationOwned = applicationOwnedReason(normalized, name);
  if (applicationOwned) return { readOnly: true, protected: true, reason: applicationOwned };
  const readOnly = name.endsWith('.rdc') || parts.includes('.git') || ['knowledge', 'inputs'].includes(category);
  const protectedPath = readOnly || ['agents', 'skills', 'hooks', 'policies', 'mcp', 'memory', 'secrets'].includes(category)
    || parts.some(part => ['.agents', '.codex', '.aws', '.ssh'].includes(part))
    || name === '.env' || name.startsWith('.env.') || name === 'config.json' && scope >= 0;
  return { readOnly, protected: protectedPath, reason: readOnly ? 'Capture inputs, Git metadata and canonical knowledge are not generic write targets.'
    : protectedPath ? 'Writing runtime configuration or credential-related paths requires specific authorization.' : 'Ordinary workspace text target.' };
}

export function assertFileWriteBoundary(target: string): void {
  const boundary = fileOperationBoundary(target);
  if (boundary.readOnly) throw new Error(`FILE_WRITE_PROTECTED: ${boundary.reason}`);
}
