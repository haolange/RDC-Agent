import * as crypto from 'crypto';
import * as fs from 'fs';
import { formatSessionArtifactUri, SessionArtifactError } from '@shared/types/sessionArtifact';
import type { SessionArtifactResolver } from '../../sessions/SessionArtifactResolver';

/** Reuse verified pixels, never a call's provenance or an artifact from another execution namespace. */
export function storeToolImage(
  resolver: SessionArtifactResolver,
  sessionId: string,
  namespace: string,
  extension: string,
  mimeType: string,
  bytes: Buffer,
): { uri: string; hash: string; created: boolean } {
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const uri = formatSessionArtifactUri('tool-outputs', `${namespace}image-${hash}.${extension}`);
  const target = resolver.resolve(sessionId, uri).absolutePath;
  if (fs.existsSync(target)) {
    // A conflicting content-addressed file is corruption, not permission to overwrite it.
    const existing = resolver.read(sessionId, uri, { expectedHash: hash });
    if (existing.bytes !== bytes.length || existing.mimeType !== mimeType) {
      throw new SessionArtifactError('ARTIFACT_HASH_MISMATCH', 'stored image metadata does not match its pixels.');
    }
    return { uri, hash, created: false };
  }
  // Existing call-named images remain valid. Reuse their exact bytes without
  // migrating references, deleting history, creating links or changing quota accounting.
  const prefix = `session://tool-outputs/${namespace}`;
  for (const candidate of resolver.list(sessionId, 'tool-outputs')) {
    if (!candidate.startsWith(prefix) || !candidate.endsWith(`.${extension}`)) continue;
    const stat = fs.lstatSync(resolver.resolve(sessionId, candidate).absolutePath);
    if (!stat.isFile() || stat.size !== bytes.length) continue;
    const existing = resolver.read(sessionId, candidate);
    if (existing.hash === hash && existing.mimeType === mimeType) return { uri: candidate, hash, created: false };
  }
  const written = resolver.write(sessionId, uri, bytes, { mimeType });
  return { uri: written.uri, hash: written.hash, created: true };
}
