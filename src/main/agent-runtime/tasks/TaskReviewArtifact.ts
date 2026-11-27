import type { SessionArtifactResolver } from '../../sessions/artifacts/SessionArtifactResolver';
import type { InvestigationArtifactService } from '../../investigation/InvestigationArtifactService';

/**
 * The current hash of a reviewable result, read by the host from its owning session: the bytes the reference names now,
 * and for an investigation record only while it is the live version. Null when the reference names nothing reviewable.
 */
export function currentTaskReviewArtifactHash(
  sessionId: string,
  uri: string,
  resolver: Pick<SessionArtifactResolver, 'read'>,
  investigation: Pick<InvestigationArtifactService, 'list' | 'readRecord'>,
): string | null {
  try {
    const hash = resolver.read(sessionId, uri, { limit: 1 }).hash;
    if (!uri.startsWith('session://investigation/records/')) return hash;
    const entry = investigation.list(sessionId).find((item) => item.contentUri === uri);
    if (!entry || (entry.status !== 'ready' && entry.status !== 'draft')) return null;
    const current = investigation.readRecord(sessionId, entry.artifactId, hash);
    return current.manifest.status === 'ready' || current.manifest.status === 'draft' ? hash : null;
  } catch {
    return null;
  }
}
