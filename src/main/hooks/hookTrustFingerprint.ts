import {
  argumentFileIdentities,
  canonicalRealpath,
  fileIdentity,
  resolveCommandOnPath,
  type FileIdentity,
} from '../runtime/fileIdentity';
import { hashScopedResource } from '../runtime/ScopedResourceResolver';
import { isNodeCommand, resolveHookArg, resolveHookCommand, resolveHookCwd } from './hookResolve';
import type { ResourceScope } from '@shared/types/rdcRuntime';
import type { HookDefinition } from './hookTypes';

export interface ExecutableIdentity {
  command: string;
  resolvedCommand: string;
  identity: FileIdentity | { unresolved: string };
}

export const resolveExecutableIdentity = (command: string): ExecutableIdentity => {
  const runtime = resolveHookCommand(command);
  const lookup = isNodeCommand(command) ? runtime.command : command;
  const resolvedPath = resolveCommandOnPath(lookup);
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
  return argumentFileIdentities(definition.args, (argument) => {
    const resolved = resolveHookArg(argument, scope, sourcePath, cwd);
    return 'unresolvedArg' in resolved ? null : resolved.resolved;
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
