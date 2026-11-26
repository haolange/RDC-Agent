import fs from 'fs';
import path from 'path';
import { commandFileNames } from '../platform/paths';
import { sha256Hex } from './contentHash';

/** What a trust decision is bound to: the resolved file and its exact bytes. */
export interface FileIdentity {
  realpath: string;
  sha256: string;
}

const identityCache = new Map<string, { statToken: string; identity: FileIdentity }>();
const IDENTITY_CACHE_LIMIT = 256;

export const canonicalRealpath = (filePath: string): string => {
  const resolved = path.resolve(filePath);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
};

/**
 * Hashes the bytes behind a path. Large executables (node, python, docker) are re-hashed only when
 * their inode, size, modification or change time moves, so trust checks stay cheap on every settings read.
 */
export const fileIdentity = (filePath: string): FileIdentity => {
  const realpath = canonicalRealpath(filePath);
  const stat = fs.statSync(realpath);
  // ctime cannot be set back by an unprivileged writer, so an in-place rewrite that restores
  // size and mtime still invalidates the cached hash.
  const statToken = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  const cached = identityCache.get(realpath);
  if (cached?.statToken === statToken) return cached.identity;
  const identity = { realpath, sha256: sha256Hex(fs.readFileSync(realpath)) };
  if (identityCache.size >= IDENTITY_CACHE_LIMIT) {
    const oldest = identityCache.keys().next().value;
    if (oldest !== undefined) identityCache.delete(oldest);
  }
  identityCache.set(realpath, { statToken, identity });
  return identity;
};

const isRegularFile = (candidate: string): boolean => {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
};

/** Resolves a command the way a spawn would: a path as given, a bare name through PATH. */
export const resolveCommandOnPath = (command: string): string | null => {
  if (!command.trim()) return null;
  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return isRegularFile(command) ? command : null;
  }
  const directories = (process.env.PATH ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const directory of directories) {
    for (const name of commandFileNames(command)) {
      const candidate = path.join(directory, name);
      if (isRegularFile(candidate)) return candidate;
    }
  }
  return null;
};

/** The executable a command would run, or the unresolved name so a later install still changes the fingerprint. */
export const commandIdentity = (command: string): FileIdentity | { unresolved: string } => {
  const resolved = resolveCommandOnPath(command);
  return resolved ? fileIdentity(resolved) : { unresolved: command };
};

/** Identities of the arguments that name existing files, so editing a launched script needs new trust. */
export const argumentFileIdentities = (
  args: readonly string[],
  resolveArgument: (argument: string) => string | null,
): Array<FileIdentity | { unresolvedArg: string }> => {
  const files: Array<FileIdentity | { unresolvedArg: string }> = [];
  for (const argument of args) {
    if (!argument || argument.startsWith('-')) continue;
    const resolved = resolveArgument(argument);
    if (resolved === null) {
      files.push({ unresolvedArg: argument });
      continue;
    }
    if (isRegularFile(resolved)) files.push(fileIdentity(resolved));
  }
  return files.sort((left, right) => {
    const leftKey = 'realpath' in left ? left.realpath : left.unresolvedArg;
    const rightKey = 'realpath' in right ? right.realpath : right.unresolvedArg;
    return leftKey.localeCompare(rightKey);
  });
};
