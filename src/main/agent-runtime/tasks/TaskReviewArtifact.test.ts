import { rmSync } from 'node:fs';
import { expect, it } from 'vitest';
import { baselineWorld, createInvestigationHarness, writeDraft } from '../../testing/investigationTestFixtures';
import { currentTaskReviewArtifactHash } from './TaskReviewArtifact';

it('resolves the current content hash and none for a superseded investigation record, without altering it', () => {
  const { sessionId, sessionPath, service, resolver } = createInvestigationHarness();
  try {
    const first = writeDraft(service, 'world_state', baselineWorld('review-world'));
    const hash = first.contentHash.replace(/^sha256:/, '');
    const current = (uri: string) => currentTaskReviewArtifactHash(sessionId, uri, resolver, service);
    expect(current(first.contentUri)).toBe(hash);
    expect(current('session://tool-outputs/missing.json')).toBeNull();
    writeDraft(service, 'world_state', baselineWorld('unrelated-world'));
    expect(current(first.contentUri)).toBe(hash);
    const replacement = writeDraft(service, 'world_state', baselineWorld('review-world'), {
      supersedes: first.manifest.artifactId,
    });
    expect(current(first.contentUri)).toBeNull();
    expect(current(replacement.contentUri)).toBe(replacement.contentHash.replace(/^sha256:/, ''));
    expect(service.readRecord(sessionId, first.manifest.artifactId).manifest.status).toBe('superseded');
  } finally {
    rmSync(sessionPath, { recursive: true, force: true });
  }
});
