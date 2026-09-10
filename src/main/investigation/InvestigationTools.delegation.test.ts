import { describe, expect, it } from 'vitest';
import { createInvestigationTools } from './InvestigationTools';
import { baselineWorld, createInvestigationHarness, writeDraft, reopenInvestigationHarness } from './investigationTestFixtures';
import { grantDelegatedArtifactAccess } from '../sessions/DelegatedArtifactAccess';
describe('delegated investigation writes', () => {
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
