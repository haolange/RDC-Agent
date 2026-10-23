import {
  ARTIFACT_READ_MAX_OUTPUT_LINES, SESSION_ARTIFACT_MAX_FILE_BYTES, SessionArtifactError,
} from '@shared/types/sessionArtifact';
import type { SessionArtifactResolver } from '../sessions/SessionArtifactResolver';

/** Internal complete JSON reads retain the Resolver's ownership, file bound and hash checks. */
export function readCompleteInvestigationArtifact(
  resolver: Pick<SessionArtifactResolver, 'read'>,
  sessionId: string,
  uri: string,
  options?: { expectedHash?: string },
) {
  const first = resolver.read(sessionId, uri, options);
  if (!first.truncated) return first;
  let page = first;
  let cursor = { offset: 1, column: 0 };
  let text = first.text ?? '';
  const maxPages = Math.ceil(SESSION_ARTIFACT_MAX_FILE_BYTES / (ARTIFACT_READ_MAX_OUTPUT_LINES - 1)) + 1;
  for (let pages = 1; pages < maxPages; pages += 1) {
    const next = page.next;
    if (!next || next.offset < cursor.offset
      || (next.offset === cursor.offset && next.column <= cursor.column)) {
      throw new SessionArtifactError('ARTIFACT_URI_INVALID', 'Incomplete or non-advancing investigation pagination.');
    }
    cursor = next;
    page = resolver.read(sessionId, uri, { ...cursor, expectedHash: options?.expectedHash ?? first.hash });
    if (page.hash !== first.hash || page.bytes !== first.bytes) {
      throw new SessionArtifactError('ARTIFACT_HASH_MISMATCH', 'Investigation source changed between pages.');
    }
    text += page.text ?? '';
    if (Buffer.byteLength(text, 'utf8') > SESSION_ARTIFACT_MAX_FILE_BYTES) {
      throw new SessionArtifactError('ARTIFACT_TOO_LARGE', 'Investigation source exceeds the existing file bound.');
    }
    if (!page.truncated) {
      const complete = { ...first, text, truncated: false, limit: first.totalLines ?? first.limit };
      delete complete.next;
      return complete;
    }
  }
  throw new SessionArtifactError('ARTIFACT_URI_INVALID', 'Investigation pagination exceeds its bounded page count.');
}
