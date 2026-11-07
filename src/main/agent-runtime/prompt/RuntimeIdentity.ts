import { isEphemeralScopeId, isSubagentScopeId } from '@shared/utils/executionScope';
import type { RdcContextLease } from '../../rdc/RdcRuntimeContextRegistry';

export function runtimeIdentityContent(scopeId: string | null, permissionRevision: number | null, lease: RdcContextLease | null): string {
  const scopeKind = !scopeId ? 'none' : isSubagentScopeId(scopeId) ? 'subagent' : isEphemeralScopeId(scopeId) ? 'ephemeral' : 'session';
  const lines = [
    '# Runtime Identity',
    'Volatile execution identity. It is not part of the stable instruction prefix and grants no tools or permissions.',
    `Session: ${scopeId ?? '(none)'}`,
    `Scope: ${scopeKind}`,
    'The live permission mode is sampled at each tool admission and is not copied here.',
    `Permission revision: ${permissionRevision ?? '(not published)'}`,
  ];
  if (lease && !lease.quarantineReason) {
    lines.push(`contextId: ${lease.contextId}`, `captureIdentityDigest: ${lease.captureHash ?? '(unverified)'}`,
      `replaySessionId: ${lease.runtimeContext.replaySessionId ?? '(none)'}`);
  }
  return lines.join('\n');
}
