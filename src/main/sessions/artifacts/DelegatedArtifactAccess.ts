import { sessionArtifactResolver } from './SessionArtifactResolver';
import type { SessionArtifactResolver } from './SessionArtifactResolver';
import { SessionArtifactError } from '@shared/types/sessionArtifact';
interface Grant { ownerSessionId: string; refs: Map<string, string>; outputs: Set<string> }
const grants = new Map<string, Grant>();
/** Freeze explicit read references before child prepareTurn. Never infer ownership from a session-id suffix. */
export function grantDelegatedArtifactAccess(childSessionId: string, parentSessionId: string, refs: readonly string[], resolver: Pick<SessionArtifactResolver, 'read'> = sessionArtifactResolver): () => void {
  if (!childSessionId || !parentSessionId || childSessionId === parentSessionId || grants.has(childSessionId)) throw new SessionArtifactError('ARTIFACT_SESSION_DENIED', 'invalid child artifact grant');
  const parent = grants.get(parentSessionId);
  const ownerSessionId = parent?.ownerSessionId ?? parentSessionId;
  const allowed = new Map<string, string>();
  for (const uri of refs) {
    if (parent && !parent.refs.has(uri)) throw new SessionArtifactError('ARTIFACT_SESSION_DENIED', 'nested delegation exceeds granted refs');
    const artifact = resolver.read(ownerSessionId, uri, { limit: 1, expectedHash: parent?.refs.get(uri) });
    allowed.set(uri, artifact.hash);
  }
  const grant = { ownerSessionId, refs: allowed, outputs: new Set<string>() };
  grants.set(childSessionId, grant);
  return () => {
    if (grants.get(childSessionId) !== grant) return;
    // Only main-registered child outputs propagate to its immediate parent. Returned text cannot grant access.
    if (parent && grants.get(parentSessionId) === parent) {
      for (const uri of grant.outputs) parent.refs.set(uri, grant.refs.get(uri)!);
    }
    grants.delete(childSessionId);
  };
}
export function delegatedArtifactOwner(sessionId: string | null | undefined): string | null {
  return sessionId ? grants.get(sessionId)?.ownerSessionId ?? null : null;
}
export function delegatedArtifactReferences(sessionId: string): Array<{ uri: string; hash: string }> | null {
  const grant = grants.get(sessionId);
  return grant ? [...grant.refs].map(([uri, hash]) => ({ uri, hash })) : null;
}
export function resolveDelegatedArtifactRead(sessionId: string, uri: string, expectedHash?: string): { sessionId: string; expectedHash?: string } {
  const grant = grants.get(sessionId);
  if (!grant) return { sessionId, expectedHash };
  const hash = grant.refs.get(uri);
  if (!hash || (expectedHash && expectedHash.replace(/^sha256:/, '') !== hash.replace(/^sha256:/, ''))) throw new SessionArtifactError('ARTIFACT_SESSION_DENIED', 'artifact is not in the frozen delegation grant');
  return { sessionId: grant.ownerSessionId, expectedHash: hash };
}
/** New child outputs are already durable in the owning session before granting readback. */
export function grantDelegatedOutput(sessionId: string, uri: string, hash: string): void {
  const grant = grants.get(sessionId);
  grant?.refs.set(uri, hash);
  grant?.outputs.add(uri);
}

export function assertDelegatedArtifactWrite(sessionId: string, uri: string): void {
  const grant = grants.get(sessionId);
  if (grant && !grant.outputs.has(uri)) throw new SessionArtifactError('ARTIFACT_SESSION_DENIED', 'read grant does not authorize replacing a parent artifact');
}
