import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { HookDefinition, ResourceScope } from '@shared/types/rdcRuntime';
import { hashScopedResource } from '../runtime/ScopedResourceResolver';
import { isNodeCommand, resolveHookArg, resolveHookCommand, resolveHookCwd } from './hookResolve';

export interface FileIdentity {
  realpath: string;
  sha256: string;
}

export interface ExecutableIdentity {
  command: string;
  resolvedCommand: string;
  identity: FileIdentity | { unresolved: string };
}

let execPathIdentityCache: { token: string; identity: FileIdentity } | undefined;

export const canonicalRealpath = (filePath: string): string => {
  const resolved = path.resolve(filePath);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
};

const hashFileBytes = (realpath: string): string => (
  createHash('sha256').update(fs.readFileSync(realpath)).digest('hex')
);

export const sha256FileBytes = (filePath: string): string => hashFileBytes(canonicalRealpath(filePath));

const processExecPathIdentity = (): FileIdentity => {
  const realpath = canonicalRealpath(process.execPath);
  const stat = fs.statSync(realpath);
  const token = `${realpath}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  if (execPathIdentityCache?.token === token) return execPathIdentityCache.identity;
  const identity = { realpath, sha256: hashFileBytes(realpath) };
  execPathIdentityCache = { token, identity };
  return identity;
};

export const fileIdentity = (filePath: string): FileIdentity => {
  const realpath = canonicalRealpath(filePath);
  if (realpath === canonicalRealpath(process.execPath)) return processExecPathIdentity();
  return { realpath, sha256: hashFileBytes(realpath) };
};

const isFlagOrEmptyArg = (value: string): boolean => !value || value.startsWith('-');

const windowsPathExtensions = (): string[] => {
  const raw = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD;.VBS;.JS';
  return raw.split(';').map((entry) => entry.trim()).filter(Boolean);
};

export const resolveCommandOnPath = (command: string): string | null => {
  if (!command.trim()) return null;
  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return fs.existsSync(command) && fs.statSync(command).isFile() ? command : null;
  }
  const dirs = (process.env.PATH ?? '').split(path.delimiter).map((entry) => entry.trim()).filter(Boolean);
  const names = process.platform === 'win32' && !path.extname(command)
    ? [command, ...windowsPathExtensions().map((ext) => `${command}${ext}`)]
    : [command];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // skip unreadable PATH entries
      }
    }
  }
  return null;
};

export const resolveExecutableIdentity = (command: string): ExecutableIdentity => {
  const runtime = resolveHookCommand(command);
  const lookup = isNodeCommand(command) ? runtime.command : command;
  const resolvedPath = path.isAbsolute(lookup) || lookup.includes('/') || lookup.includes('\\')
    ? (fs.existsSync(lookup) && fs.statSync(lookup).isFile() ? lookup : null)
    : resolveCommandOnPath(lookup);
  if (!resolvedPath) {
    return {
      command,
      resolvedCommand: runtime.command,
      identity: { unresolved: runtime.command },
    };
  }
  return {
    command,
    resolvedCommand: runtime.command,
    identity: fileIdentity(resolvedPath),
  };
};

export const resolveReferencedFileIdentities = (
  definition: HookDefinition,
  scope: ResourceScope,
  sourcePath: string,
  projectRoot?: string,
): Array<FileIdentity | { unresolvedArg: string }> => {
  const cwd = resolveHookCwd(definition, projectRoot);
  const files: Array<FileIdentity | { unresolvedArg: string }> = [];
  for (const arg of definition.args) {
    if (isFlagOrEmptyArg(arg)) continue;
    const resolved = resolveHookArg(arg, scope, sourcePath, cwd);
    if ('unresolvedArg' in resolved) {
      files.push({ unresolvedArg: resolved.unresolvedArg });
      continue;
    }
    try {
      if (fs.existsSync(resolved.resolved) && fs.statSync(resolved.resolved).isFile()) {
        files.push(fileIdentity(resolved.resolved));
      }
    } catch {
      files.push({ unresolvedArg: arg });
    }
  }
  return files.sort((left, right) => {
    const leftKey = 'realpath' in left ? left.realpath : left.unresolvedArg;
    const rightKey = 'realpath' in right ? right.realpath : right.unresolvedArg;
    return leftKey.localeCompare(rightKey);
  });
};

export const computeHookTrustFingerprint = (input: {
  definition: HookDefinition;
  scope: ResourceScope;
  sourcePath: string;
  projectRoot?: string;
}): string => {
  const sourceRealpath = canonicalRealpath(input.sourcePath);
  return hashScopedResource({
    kind: 'hook-trust-fingerprint',
    definition: input.definition,
    files: resolveReferencedFileIdentities(input.definition, input.scope, input.sourcePath, input.projectRoot),
    executable: resolveExecutableIdentity(input.definition.command),
    scope: input.scope,
    provenance: {
      scope: input.scope,
      sourcePath: sourceRealpath,
    },
  });
};
