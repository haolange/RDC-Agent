import fs from 'fs';
import path from 'path';
import type { HookDefinition } from '@shared/types/rdxRuntime';
import { appPathService } from '../runtime/AppPathService';

export const isNodeCommand = (command: string): boolean => /^node(\.exe)?$/i.test(command);

export const isInsideRoot = (candidate: string, root: string): boolean => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

export const officialBuiltinScriptRoots = (sourcePath: string): string[] => {
  const roots = [path.dirname(sourcePath), appPathService.getBuiltinHooksPath()];
  if (process.resourcesPath) roots.push(path.join(process.resourcesPath, 'agent-runtime', 'hooks'));
  return [...new Set(roots.map((root) => path.resolve(root)))];
};

export const resolveBuiltinScriptArg = (arg: string, sourcePath: string): string | null => {
  if (!arg || arg.startsWith('-') || path.isAbsolute(arg)) return arg;
  const names = arg === path.basename(arg) ? [arg] : [arg, path.basename(arg)];
  for (const root of officialBuiltinScriptRoots(sourcePath)) {
    for (const name of names) {
      const candidate = path.resolve(root, name);
      if (isInsideRoot(candidate, root) && fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
};

export const resolveExistingRelativePath = (arg: string, sourcePath: string, cwd: string): string => {
  if (!arg || arg.startsWith('-') || path.isAbsolute(arg)) return arg;
  const seen = new Set<string>();
  for (const start of [path.dirname(sourcePath), cwd]) {
    let dir = path.resolve(start);
    for (let depth = 0; depth < 8; depth += 1) {
      if (seen.has(dir)) break;
      seen.add(dir);
      const candidate = path.resolve(dir, arg);
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return arg;
};

export const resolveHookCwd = (definition: HookDefinition, projectRoot?: string): string => {
  const base = projectRoot ?? process.cwd();
  return definition.cwd ? path.resolve(base, definition.cwd) : base;
};

export const resolveHookCommand = (command: string): { command: string; electronAsNode: boolean } => {
  if (!isNodeCommand(command)) return { command, electronAsNode: false };
  return {
    command: process.execPath,
    electronAsNode: !isNodeCommand(path.basename(process.execPath)),
  };
};

export const resolveHookArg = (
  arg: string,
  scope: 'builtin' | 'user' | 'project',
  sourcePath: string,
  cwd: string,
): { resolved: string } | { unresolvedArg: string } => {
  if (scope === 'builtin') {
    const resolved = resolveBuiltinScriptArg(arg, sourcePath);
    if (resolved === null) return { unresolvedArg: arg };
    return { resolved };
  }
  return { resolved: resolveExistingRelativePath(arg, sourcePath, cwd) };
};

export const resolveHookSpawn = (
  definition: HookDefinition,
  scope: 'builtin' | 'user' | 'project',
  sourcePath: string,
  cwd: string,
): { command: string; args: string[]; electronAsNode: boolean } | { unresolvedArg: string } => {
  const runtime = resolveHookCommand(definition.command);
  const args: string[] = [];
  for (const arg of definition.args) {
    const resolved = resolveHookArg(arg, scope, sourcePath, cwd);
    if ('unresolvedArg' in resolved) return resolved;
    args.push(resolved.resolved);
  }
  return {
    command: runtime.command,
    args,
    electronAsNode: runtime.electronAsNode,
  };
};
