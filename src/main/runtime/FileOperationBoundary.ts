import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '@shared/errors/appError';
import { appPathService } from './AppPathService';

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
  const category = scope >= 0 ? (parts[scope + 1] ?? '') : '';
  const applicationOwned = applicationOwnedReason(normalized, name);
  if (applicationOwned) return { readOnly: true, protected: true, reason: applicationOwned };
  const readOnly = name.endsWith('.rdc') || parts.includes('.git') || ['knowledge', 'inputs'].includes(category);
  const protectedPath =
    readOnly ||
    ['agents', 'skills', 'hooks', 'policies', 'mcp', 'memory', 'secrets'].includes(category) ||
    parts.some((part) => ['.agents', '.codex', '.aws', '.ssh'].includes(part)) ||
    name === '.env' ||
    name.startsWith('.env.') ||
    (name === 'config.json' && scope >= 0);
  return {
    readOnly,
    protected: protectedPath,
    reason: readOnly
      ? 'Capture inputs, Git metadata and canonical knowledge are not generic write targets.'
      : protectedPath
        ? 'Writing runtime configuration or credential-related paths requires specific authorization.'
        : 'Ordinary workspace text target.',
  };
}

export function assertFileWriteBoundary(target: string): void {
  const boundary = fileOperationBoundary(target);
  if (boundary.readOnly) throw new AppError('FILE_WRITE_PROTECTED', boundary.reason);
}

/** The comparison spelling of a path: the realpath of its longest existing ancestor plus the rest, normalized. */
function canonical(target: string): string {
  let current = path.resolve(target);
  const missing: string[] = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.unshift(path.basename(current));
    current = parent;
  }
  let resolved = current;
  try {
    resolved = fs.realpathSync.native(current);
  } catch {
    // An ancestor that vanished meanwhile keeps its lexical spelling; the comparison stays on the resolved prefix.
  }
  return normalize(path.join(resolved, ...missing));
}

/**
 * What no agent file tool reads, copies or enumerates in any permission mode: the minidumps under
 * `<appStateRoot>/crash` (plain snapshots of process memory, which can hold decrypted provider keys) and the
 * credential stores. The roots are compared in their realpath spelling; the returned check takes a path already in
 * that spelling (what `safeResolvePath` returns, or an entry a walk listed under such a path without following links).
 */
export function fileReadProtection(): (resolvedTarget: string) => boolean {
  const state = appPathService.getAppStatePaths();
  const roots = [
    path.join(state.appStateRoot, 'crash'),
    state.secretsPath,
    path.join(appPathService.getUserRdcPaths().userRdcRoot, 'secrets'),
  ].map(canonical);
  return (resolvedTarget) => {
    const resolved = normalize(resolvedTarget);
    return roots.some((root) => within(resolved, root));
  };
}

/** Read boundary of every agent file-reading primitive, applied to the realpath `safeResolvePath` returns. */
export function assertFileReadBoundary(target: string): void {
  if (fileReadProtection()(canonical(target))) {
    throw new AppError('FILE_READ_PROTECTED', 'crash files and credential stores are never read by agent tools.');
  }
}
