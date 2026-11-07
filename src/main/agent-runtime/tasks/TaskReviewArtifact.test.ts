import { rmSync } from 'node:fs';
import { expect, it } from 'vitest';
import { baselineWorld, createInvestigationHarness, writeDraft } from '../../investigation/investigationTestFixtures';
import { verifyTaskReviewArtifact } from './TaskReviewArtifact';

it('accepts the current content and rejects a superseded investigation record without altering it', () => {
  const { sessionId, sessionPath, service, resolver } = createInvestigationHarness();
  try {
    const first = writeDraft(service, 'world_state', baselineWorld('review-world'));
    const hash = first.contentHash.replace(/^sha256:/, '');
    const verify = (uri: string, expectedHash: string) => verifyTaskReviewArtifact(sessionId, uri, expectedHash, resolver, service);
    expect(verify(first.contentUri, hash)).toBe(true);
    expect(verify(first.contentUri, '0'.repeat(64))).toBe(false);
    writeDraft(service, 'world_state', baselineWorld('unrelated-world'));
    expect(verify(first.contentUri, hash)).toBe(true);
    const replacement = writeDraft(service, 'world_state', baselineWorld('review-world'), { supersedes: first.manifest.artifactId });
    expect(verify(first.contentUri, hash)).toBe(false);
    expect(verify(replacement.contentUri, replacement.contentHash.replace(/^sha256:/, ''))).toBe(true);
    expect(service.readRecord(sessionId, first.manifest.artifactId).manifest.status).toBe('superseded');
  } finally {
    rmSync(sessionPath, { recursive: true, force: true });
  }
});
