import type { SessionArtifactResolver } from '../../sessions/artifacts/SessionArtifactResolver';
import type { InvestigationArtifactService } from '../../investigation/InvestigationArtifactService';

/** Verify the actual reviewed bytes and, for investigation records, their current lifecycle status. */
export function verifyTaskReviewArtifact(
  sessionId: string, uri: string, hash: string,
  resolver: Pick<SessionArtifactResolver, 'read'>,
  investigation: Pick<InvestigationArtifactService, 'list' | 'readRecord'>,
): boolean {
  try {
    if (resolver.read(sessionId, uri, { expectedHash: hash, limit: 1 }).hash !== hash) return false;
    if (!uri.startsWith('session://investigation/records/')) return true;
    const entry = investigation.list(sessionId).find(item => item.contentUri === uri);
    if (!entry || (entry.status !== 'ready' && entry.status !== 'draft')) return false;
    const current = investigation.readRecord(sessionId, entry.artifactId, hash);
    return current.manifest.status === 'ready' || current.manifest.status === 'draft';
  } catch {
    return false;
  }
}
