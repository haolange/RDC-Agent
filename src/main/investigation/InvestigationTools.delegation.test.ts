import { describe, expect, it } from 'vitest';
import { createInvestigationTools } from './InvestigationTools';
import { baselineWorld, createInvestigationHarness, writeDraft, reopenInvestigationHarness } from './investigationTestFixtures';
import { grantDelegatedArtifactAccess } from '../sessions/DelegatedArtifactAccess';
describe('delegated investigation writes', () => {
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
