import { describe, expect, it } from 'vitest';
import { createInvestigationTools } from './InvestigationTools';
import { baselineWorld, createInvestigationHarness, observedClaim, sampleChallenge, writeDraft, reopenInvestigationHarness } from './investigationTestFixtures';
import { grantDelegatedArtifactAccess } from '../sessions/DelegatedArtifactAccess';
describe('delegated investigation writes', () => {
  it('exposes authoritative version metadata without granting the predecessor or permitting a false hash', async () => {
    const { service, resolver, sessionId } = createInvestigationHarness();
    const first = writeDraft(service, 'world_state', baselineWorld('versioned-world'));
    const revised = writeDraft(service, 'world_state', baselineWorld('versioned-world'), { supersedes: first.manifest.artifactId });
    const release = grantDelegatedArtifactAccess('version-reader', sessionId, [revised.contentUri], resolver);
    try {
      const tools = createInvestigationTools('version-reader', { service });
      const read = tools.find(tool => tool.name === 'investigation_read')!;
      const result = await read.execute('read', { artifactId: revised.manifest.artifactId, expectedHash: revised.contentHash });
      expect(result.isError).not.toBe(true);
      expect(result.content[0]).toMatchObject({ text: expect.stringContaining(JSON.stringify({
        artifactId: revised.manifest.artifactId, status: revised.manifest.status,
        contentRef: revised.contentUri, contentHash: revised.contentHash, supersedes: first.manifest.artifactId,
      })) });
      const list = await tools.find(tool => tool.name === 'investigation_list')!.execute('list', {});
      expect(list.details).toMatchObject({ count: 1 });
      expect(list.content[0]).toMatchObject({ text: expect.stringContaining(`"supersedes":"${first.manifest.artifactId}"`) });
      expect((await read.execute('predecessor', { artifactId: first.manifest.artifactId })).isError).toBe(true);
      expect((await read.execute('forged-hash', { artifactId: revised.manifest.artifactId, expectedHash: `sha256:${'0'.repeat(64)}` })).isError).toBe(true);
      expect(service.readRecord(sessionId, first.manifest.artifactId).manifest.status).toBe('superseded');
    } finally { release(); }
    const original = await createInvestigationTools(sessionId, { service }).find(tool => tool.name === 'investigation_read')!
      .execute('original', { artifactId: first.manifest.artifactId });
    expect(original.content[0]).toMatchObject({ text: expect.stringContaining('"supersedes":null') });
  });
  it('persists an open ready Challenge using exact granted Investigation provenance and rejects empty, false, or ungranted sources', async () => {
    const { service, resolver, sessionId, sessionPath } = createInvestigationHarness();
    writeDraft(service, 'world_state', baselineWorld('review-world'));
    const claim = writeDraft(service, 'claim', observedClaim('review-world', 'review-claim'));
    const unrelated = writeDraft(service, 'claim', observedClaim('review-world', 'other-claim'));
    const release = grantDelegatedArtifactAccess('review-child', sessionId, [claim.contentUri], resolver);
    try {
      const tools = createInvestigationTools('review-child', { service });
      const read = tools.find(tool => tool.name === 'investigation_read')!;
      const write = tools.find(tool => tool.name === 'investigation_write')!;
      const source = await read.execute('source', { artifactId: claim.manifest.artifactId });
      expect(source.details).toMatchObject({ ok: true, contentHash: claim.contentHash });
      const input = {
        kind: 'challenge', mission: 'debugger', title: 'Bounded review', summary: 'Missing distinguishing evidence',
        worldStateId: 'review-world', status: 'ready', record: sampleChallenge({ targetId: 'review-claim' }),
      };
      expect((await write.execute('empty', { ...input, sourceRefs: [] })).details)
        .toMatchObject({ code: 'INVESTIGATION_READY_DENIED' });
      expect((await write.execute('false-hash', { ...input, sourceRefs: [{ artifactId: claim.manifest.artifactId, expectedHash: `sha256:${'0'.repeat(64)}` }] })).isError).toBe(true);
      expect((await write.execute('ungranted', { ...input, sourceRefs: [{ artifactId: unrelated.manifest.artifactId, expectedHash: unrelated.contentHash }] })).isError).toBe(true);
      const result = await write.execute('ready', {
        ...input, sourceRefs: [{ artifactId: claim.manifest.artifactId, expectedHash: claim.contentHash }],
      });
      expect(result.isError).not.toBe(true);
      const challenges = service.list(sessionId, { kind: 'challenge' });
      expect(challenges).toHaveLength(1);
      const persisted = reopenInvestigationHarness(sessionPath).service.readRecord(sessionId, challenges[0].artifactId);
      expect(persisted.manifest).toMatchObject({ status: 'ready', sourceRefs: [{ artifactId: claim.manifest.artifactId, expectedHash: claim.contentHash }] });
      expect(persisted.record).toMatchObject({ status: 'open', targetRef: { type: 'claim', id: 'review-claim' } });
    } finally { release(); }
  });

  it('requires the exact parent content URI for a child to list and read a cited record', async () => {
    const { service, resolver, sessionId } = createInvestigationHarness();
    const cited = writeDraft(service, 'world_state', baselineWorld('cited-world'), { mission: 'debugger' });
    const unrelated = writeDraft(service, 'world_state', baselineWorld('unrelated-world'), { mission: 'debugger' });
    const deniedRelease = grantDelegatedArtifactAccess('child-with-id-only', sessionId, [], resolver);
    try {
      const tools = createInvestigationTools('child-with-id-only', { service });
      const list = await tools.find(tool => tool.name === 'investigation_list')!.execute('list', {});
      const read = await tools.find(tool => tool.name === 'investigation_read')!.execute('read', { artifactId: cited.manifest.artifactId });
      expect(list.details).toMatchObject({ count: 0 });
      expect(read.details).toMatchObject({ code: 'INVESTIGATION_SESSION_DENIED', details: { artifactCode: 'ARTIFACT_SESSION_DENIED' } });
    } finally { deniedRelease(); }

    const allowedRelease = grantDelegatedArtifactAccess('child-with-uri', sessionId, [cited.contentUri], resolver);
    try {
      const tools = createInvestigationTools('child-with-uri', { service });
      const list = await tools.find(tool => tool.name === 'investigation_list')!.execute('list', {});
      const read = await tools.find(tool => tool.name === 'investigation_read')!.execute('read', { artifactId: cited.manifest.artifactId, expectedHash: cited.contentHash });
      const other = await tools.find(tool => tool.name === 'investigation_read')!.execute('other', { artifactId: unrelated.manifest.artifactId });
      expect(list.details).toMatchObject({ count: 1 });
      expect(list.content[0]).toMatchObject({ text: expect.stringContaining(cited.contentUri) });
      expect(read.details).toMatchObject({ ok: true, contentUri: cited.contentUri, contentHash: cited.contentHash });
      expect(other.details).toMatchObject({ code: 'INVESTIGATION_SESSION_DENIED', details: { artifactCode: 'ARTIFACT_SESSION_DENIED' } });
    } finally { allowedRelease(); }
  });

  it('creates durable root-owned output with a new explicit id but cannot supersede a read-granted parent record', async () => {
    const { service, resolver, sessionId, sessionPath } = createInvestigationHarness();
    const parent = writeDraft(service, 'world_state', baselineWorld('parent-world'), { mission: 'debugger' });
    const release = grantDelegatedArtifactAccess('child', sessionId, [parent.contentUri], resolver);
    const write = createInvestigationTools('child', { service }).find(tool => tool.name === 'investigation_write')!;
    try {
      const blocked = await write.execute('denied', { kind: 'world_state', mission: 'debugger', title: 'replace', summary: 'replace', record: baselineWorld('parent-world'), supersedes: parent.manifest.artifactId });
      expect(blocked.isError).toBe(true);
      expect(service.readRecord(sessionId, parent.manifest.artifactId).manifest.status).not.toBe('superseded');
      const created = await write.execute('create', { kind: 'world_state', mission: 'debugger', title: 'child', summary: 'child', record: baselineWorld('child-world'), artifactId: 'child-output' });
      expect(created.isError).not.toBe(true);
      expect(service.readRecord(sessionId, 'child-output').record).toMatchObject({ worldStateId: 'child-world' });
    } finally { release(); }
    const reopened = reopenInvestigationHarness(sessionPath);
    expect(reopened.service.readRecord(sessionId, 'child-output').record).toMatchObject({ worldStateId: 'child-world' });
    expect(() => reopened.service.readRecord('unrelated-session', 'child-output')).toThrow();
  });
});
