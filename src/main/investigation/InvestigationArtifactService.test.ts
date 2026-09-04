import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatInvestigationContentHash, type ClaimRecord } from '@shared/types/renderdocInvestigation';
import { SESSION_ARTIFACT_ROOT_DIR } from '@shared/types/sessionArtifact';
import { InvestigationError } from './investigationErrors';
import { serializeInvestigationJson } from './investigationHash';
import {
  SESSION_ID,
  baselineWorld,
  createInvestigationHarness,
  evidenceOf,
  exclusiveWorld,
  forceReadyEmptySourceRefs,
  hypothesisClaim,
  observedClaim,
  overwriteInvestigationManifest,
  overwriteInvestigationRecordBody,
  plantInvestigationRecord,
  recordedExperiment,
  sampleReport,
  seedNote,
  writeDraft,
} from './investigationTestFixtures';
import { toolToDefinition } from '../agent-runtime/agent/AgentTool';
import { toolValidator } from '../agent-runtime/core/ToolValidator';
import { createInvestigationTools } from './InvestigationTools';

function indexPath(sessionPath: string): string {
  return path.join(sessionPath, SESSION_ARTIFACT_ROOT_DIR, 'investigation', 'index.json');
}

function toolErrorCode(result: { details?: unknown }): string | undefined {
  const details = result.details as { code?: string } | undefined;
  return details?.code;
}

describe('InvestigationArtifactService', { timeout: 15_000 }, () => {
  it('supersedes the previous manifest on version update', () => {
    const { service } = createInvestigationHarness();
    const first = writeDraft(service, 'world_state', baselineWorld('ws-v1'));
    const second = service.writeRecord(SESSION_ID, {
      kind: 'world_state',
      mission: 'debugger',
      title: 'v2',
      summary: 'replaced',
      record: baselineWorld('ws-v1'),
      supersedes: first.manifest.artifactId,
      status: 'draft',
    });
    expect(second.supersededArtifactId).toBe(first.manifest.artifactId);
    expect(second.manifest.supersedes).toBe(first.manifest.artifactId);
    expect(service.readRecord(SESSION_ID, first.manifest.artifactId).manifest.status).toBe('superseded');
    expect(service.list(SESSION_ID).map((entry) => entry.status)).toEqual(['superseded', 'draft']);
  });

  it('rejects opaque provider payloads and missing session', () => {
    const { service } = createInvestigationHarness();
    expect(() => writeDraft(service, 'world_state', {
      ...baselineWorld(),
      opaqueProviderPayload: { raw: true },
    })).toThrow(/INVESTIGATION_OPAQUE_PAYLOAD_DENIED|INVESTIGATION_SCHEMA_INVALID/);
    expect(() => service.writeRecord(null, {
      kind: 'world_state',
      mission: 'debugger',
      title: 'no session',
      summary: 'no session',
      record: baselineWorld(),
    })).toThrow(InvestigationError);
  });

  it('lists and reads through tools without silent downgrade', async () => {
    const { service } = createInvestigationHarness();
    const written = writeDraft(service, 'world_state', baselineWorld());
    const tools = Object.fromEntries(createInvestigationTools(SESSION_ID, { service }).map((tool) => [tool.name, tool]));
    const listed = await tools.investigation_list.execute('c1', {});
    expect(listed.isError).not.toBe(true);
    expect(listed.details).toMatchObject({ count: 1 });
    const read = await tools.investigation_read.execute('c2', {
      artifactId: written.manifest.artifactId,
      expectedHash: written.contentHash,
    });
    expect(read.isError).not.toBe(true);
    const failed = await tools.investigation_write.execute('c3', {
      kind: 'claim',
      mission: 'debugger',
      title: 'bad',
      summary: 'bad',
      record: hypothesisClaim('missing-world'),
      status: 'ready',
    });
    expect(failed.isError).toBe(true);
    expect(String(failed.content[0] && 'text' in failed.content[0] ? failed.content[0].text : '')).toMatch(
      /INVESTIGATION_REF_UNRESOLVED|INVESTIGATION_READY_DENIED/,
    );
    expect(formatInvestigationContentHash(written.contentHash.replace(/^sha256:/, ''))).toBe(written.contentHash);
  });

  it('lets investigation_write record bodies pass ToolValidator as an opaque object', () => {
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    writeDraft(service, 'world_state', baselineWorld());
    const tools = createInvestigationTools(SESSION_ID, { service });
    const writeTool = tools.find((tool) => tool.name === 'investigation_write');
    expect(writeTool).toBeDefined();
    const args = toolValidator.validate(toolToDefinition(writeTool!), {
      kind: 'evidence',
      mission: 'debugger',
      title: 'observed compare',
      summary: 'Before/after color mismatch',
      record: evidenceOf('ws-baseline', note),
    });
    expect(args.record).toMatchObject({ evidenceId: 'ev-1', worldStateId: 'ws-baseline' });
  });

  it('lets a report cite an existing claimId without superseding the source claim', () => {
    const { service } = createInvestigationHarness();
    writeDraft(service, 'world_state', baselineWorld());
    writeDraft(service, 'claim', observedClaim('ws-baseline', 'cl-cite'));
    const report = writeDraft(service, 'report', sampleReport({
      claims: [{
        ...observedClaim('ws-baseline', 'cl-cite'),
        projectionKind: 'report',
        compactProvenance: [{
          sourceClaimId: 'cl-cite',
          sourceEpistemicStatus: 'observed',
          sourceVerificationLevel: 'observed',
        }],
      }],
    }), { title: 'cite', summary: 'cite' });
    expect(report.manifest.supersedes).toBeUndefined();
    expect(service.createLookup(SESSION_ID).getClaim('cl-cite')).toMatchObject({ claimId: 'cl-cite' });
  });

  it('P1-1 treats unresolvable verifyEvidence as isolation failure', () => {
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    writeDraft(service, 'world_state', baselineWorld('ws-a'));
    writeDraft(service, 'world_state', exclusiveWorld('ws-b'));
    writeDraft(service, 'world_state', baselineWorld('ws-c'));
    writeDraft(service, 'claim', hypothesisClaim('ws-a'));
    writeDraft(service, 'evidence', evidenceOf('ws-c', note, 'ev-real'));
    plantInvestigationRecord(resolver, {
      artifactId: 'art-exp-fake',
      kind: 'experiment',
      recordType: 'ExperimentRecord',
      recordKey: 'exp-planted',
      record: recordedExperiment({
        experimentId: 'exp-planted',
        hypothesisClaimId: 'claim-hyp',
        baselineWorldStateId: 'ws-a',
        variantWorldStateId: 'ws-dirty-iso',
        restoredWorldStateId: 'ws-c',
        verifyEvidenceIds: ['ev-ghost'],
      }),
    });
    const polluted = writeDraft(service, 'world_state', exclusiveWorld('ws-dirty-iso', true));
    expect(polluted.record).toMatchObject({ validity: 'polluted' });
    expect(() => writeDraft(service, 'experiment', recordedExperiment({
      experimentId: 'exp-write-fail',
      hypothesisClaimId: 'claim-hyp',
      baselineWorldStateId: 'ws-a',
      variantWorldStateId: 'ws-b',
      restoredWorldStateId: 'ws-c',
      verifyEvidenceIds: ['ev-ghost'],
    }))).toThrow(InvestigationError);
  });

  it('P1-2 / P1-3 run full invariants on packs, claim sets, and reports', () => {
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    const world = writeDraft(service, 'world_state', baselineWorld());
    const claim = writeDraft(service, 'claim', observedClaim('ws-baseline'));
    const evidence = writeDraft(service, 'evidence', evidenceOf('ws-baseline', note, 'ev-pack'));
    expect(writeDraft(service, 'evidence_pack', { items: [evidenceOf('ws-baseline', note, 'ev-pack-item')] }).manifest.kind)
      .toBe('evidence_pack');
    expect(writeDraft(service, 'claim_set', { items: [hypothesisClaim('ws-baseline', 'claim-set-1')] }).manifest.kind)
      .toBe('claim_set');
    const projected: ClaimRecord = {
      ...(claim.record as ClaimRecord),
      claimId: 'claim-projected-report',
      projectionKind: 'report',
      compactProvenance: [{
        sourceClaimId: (claim.record as ClaimRecord).claimId,
        sourceEpistemicStatus: (claim.record as ClaimRecord).epistemic,
        sourceVerificationLevel: (claim.record as ClaimRecord).verification,
      }],
    };
    expect(writeDraft(service, 'report', sampleReport({
      claims: [projected],
      evidenceIds: ['ev-pack'],
    })).manifest.kind).toBe('report');
    expect(() => writeDraft(service, 'evidence_pack', {
      items: [evidenceOf('ws-missing', note, 'ev-bad-pack')],
    })).toThrow(/INVESTIGATION_REF_UNRESOLVED|S-STATE-01/);
    expect(() => writeDraft(service, 'claim_set', {
      items: [hypothesisClaim('ws-missing', 'claim-bad-set')],
    })).toThrow(/INVESTIGATION_REF_UNRESOLVED/);
    expect(() => writeDraft(service, 'report', sampleReport({
      claims: [projected],
      evidenceIds: ['ev-ghost'],
    }))).toThrow(/INVESTIGATION_REF_UNRESOLVED/);
    expect(() => writeDraft(service, 'report', sampleReport({
      claims: [projected],
      evidenceIds: ['ev-pack'],
      experimentIds: ['exp-ghost'],
    }))).toThrow(/INVESTIGATION_REF_UNRESOLVED/);
    expect(() => writeDraft(service, 'report', sampleReport({
      claims: [{
        ...(claim.record as ClaimRecord),
        claimId: 'claim-no-prov',
        projectionKind: null,
        compactProvenance: null,
      }],
    }))).toThrow(/S-CLAIM-01|compactProvenance/);
    expect(() => service.writeRecord(SESSION_ID, {
      kind: 'report',
      mission: 'debugger',
      title: 'ready denied',
      summary: 'no provenance',
      record: sampleReport({
        claims: [{
          ...(claim.record as ClaimRecord),
          claimId: 'claim-ready-denied',
          projectionKind: null,
          compactProvenance: null,
        }],
      }),
      sourceRefs: [{ artifactId: world.manifest.artifactId, expectedHash: world.contentHash }],
      status: 'ready',
    })).toThrow(/S-CLAIM-01|compactProvenance|INVESTIGATION_READY_DENIED|INVESTIGATION_INVARIANT/);
    expect(evidence.manifest.kind).toBe('evidence');
  });

  it('rejects report write when input.mission does not match InvestigationReport.mission', () => {
    const { service } = createInvestigationHarness();
    let thrown: unknown;
    try {
      service.writeRecord(SESSION_ID, {
        kind: 'report',
        mission: 'debugger',
        title: 'mission mismatch',
        summary: 'input debugger vs body analyzer',
        record: sampleReport({
          mission: 'analyzer',
          claims: [],
        }),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(InvestigationError);
    expect((thrown as InvestigationError).code).toBe('INVESTIGATION_INVARIANT_VIOLATION');
  });

  it('P1-4 syncs manifest hash when evidence becomes stale and fail-closes on drift', () => {
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    const world = writeDraft(service, 'world_state', baselineWorld('ws-stale-src'));
    const evidence = writeDraft(service, 'evidence', evidenceOf('ws-stale-src', note, 'ev-pre'));
    const polluted = writeDraft(service, 'world_state', {
      ...exclusiveWorld('ws-stale-src', true),
      replay: { adapter: 'vk', driver: 'adreno', device: 'device-0', exclusiveLock: false },
    }, { supersedes: world.manifest.artifactId });
    expect(polluted.record).toMatchObject({ validity: 'polluted' });
    const reread = service.readRecord(SESSION_ID, evidence.manifest.artifactId);
    expect(reread.record).toMatchObject({ stale: true });
    expect(reread.manifest.status).toBe('stale');
    expect(reread.manifest.contentHash).toBe(reread.contentHash);
    const listed = service.list(SESSION_ID).find((entry) => entry.artifactId === evidence.manifest.artifactId);
    expect(listed?.contentHash).toBe(reread.contentHash);
    expect(listed?.status).toBe('stale');
    resolver.write(
      SESSION_ID,
      reread.contentUri,
      serializeInvestigationJson({ ...reread.record, summary: 'tampered' }),
      { mimeType: 'application/json' },
    );
    expect(() => service.readRecord(SESSION_ID, evidence.manifest.artifactId)).toThrow(/INVESTIGATION_HASH_MISMATCH/);
  });

  it('P1-5 fail-closes on missing or corrupt index', () => {
    const { sessionPath, service } = createInvestigationHarness();
    expect(service.list(SESSION_ID)).toEqual([]);
    writeDraft(service, 'world_state', baselineWorld('ws-idx'));
    writeFileSync(indexPath(sessionPath), '{not-json', 'utf8');
    expect(() => service.list(SESSION_ID)).toThrow(/INVESTIGATION_INDEX_CORRUPT/);
    expect(() => writeDraft(service, 'world_state', baselineWorld('ws-idx-2'))).toThrow(/INVESTIGATION_INDEX_CORRUPT/);

    const fresh = createInvestigationHarness();
    writeDraft(fresh.service, 'world_state', baselineWorld('ws-gone'));
    unlinkSync(indexPath(fresh.sessionPath));
    expect(() => fresh.service.list(SESSION_ID)).toThrow(/INVESTIGATION_INDEX_MISSING/);
    expect(() => writeDraft(fresh.service, 'world_state', baselineWorld('ws-gone-2'))).toThrow(/INVESTIGATION_INDEX_MISSING/);
  });

  it('P1-6 tools always return a typed code and reject illegal status', async () => {
    const { service } = createInvestigationHarness();
    const tools = Object.fromEntries(createInvestigationTools(SESSION_ID, { service }).map((tool) => [tool.name, tool]));
    const illegal = await tools.investigation_write.execute('c-status', {
      kind: 'world_state',
      mission: 'debugger',
      title: 'illegal status',
      summary: 'must fail closed',
      record: baselineWorld('ws-status'),
      status: 'published',
    });
    expect(illegal.isError).toBe(true);
    expect(illegal.details).toMatchObject({ ok: false, code: 'INVESTIGATION_SCHEMA_INVALID' });
    expect(toolErrorCode(illegal)).toBe('INVESTIGATION_SCHEMA_INVALID');
    const schema = await tools.investigation_write.execute('c-schema', {
      kind: 'claim',
      mission: 'debugger',
      title: 'bad schema',
      summary: 'zod',
      record: { claimId: 'broken' },
    });
    expect(schema.isError).toBe(true);
    expect(schema.details).toMatchObject({ ok: false, code: 'INVESTIGATION_SCHEMA_INVALID' });
    expect(toolErrorCode(schema)).toBe('INVESTIGATION_SCHEMA_INVALID');
    const omitted = await tools.investigation_write.execute('c-omit', {
      kind: 'world_state',
      mission: 'debugger',
      title: 'default draft',
      summary: 'omitted status',
      record: baselineWorld('ws-omit'),
    });
    expect(omitted.isError).not.toBe(true);
    expect(omitted.details).toMatchObject({ ok: true });
    expect((omitted.details as { manifest: { status: string } }).manifest.status).toBe('draft');
  });

  it('P1-7 rejects duplicate artifact and record ids unless superseding', () => {
    const { service } = createInvestigationHarness();
    const first = writeDraft(service, 'world_state', baselineWorld('ws-dup'), { artifactId: 'art-stable' });
    expect(() => writeDraft(service, 'world_state', baselineWorld('ws-other'), { artifactId: 'art-stable' }))
      .toThrow(/INVESTIGATION_DUPLICATE_ID/);
    expect(() => writeDraft(service, 'world_state', baselineWorld('ws-dup')))
      .toThrow(/INVESTIGATION_DUPLICATE_ID/);
    const versioned = writeDraft(service, 'world_state', baselineWorld('ws-dup'), {
      supersedes: first.manifest.artifactId,
    });
    expect(versioned.supersededArtifactId).toBe(first.manifest.artifactId);
    expect(service.readRecord(SESSION_ID, first.manifest.artifactId).manifest.status).toBe('superseded');
  });

  it('P1-1 historical record ids require supersedes of the owner chain', () => {
    const { service } = createInvestigationHarness();
    writeDraft(service, 'world_state', baselineWorld('ws-hist'));
    const first = writeDraft(service, 'claim', observedClaim('ws-hist', 'claim-C1'));
    const second = writeDraft(service, 'claim', observedClaim('ws-hist', 'claim-C1'), {
      supersedes: first.manifest.artifactId,
    });
    expect(service.readRecord(SESSION_ID, first.manifest.artifactId).manifest.status).toBe('superseded');
    expect(() => writeDraft(service, 'claim', observedClaim('ws-hist', 'claim-C1')))
      .toThrow(/INVESTIGATION_DUPLICATE_ID/);
    const third = writeDraft(service, 'claim', observedClaim('ws-hist', 'claim-C1'), {
      supersedes: second.manifest.artifactId,
    });
    expect(third.supersededArtifactId).toBe(second.manifest.artifactId);
    expect(service.createLookup(SESSION_ID).getClaim('claim-C1')).toMatchObject({ claimId: 'claim-C1' });
  });

  it('P1-2 live pack and set members resolve for refs', { timeout: 15_000 }, () => {
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    writeDraft(service, 'world_state', baselineWorld('ws-agg-a'));
    writeDraft(service, 'world_state', exclusiveWorld('ws-agg-b'));
    writeDraft(service, 'world_state', baselineWorld('ws-agg-c'));
    const packed = writeDraft(service, 'evidence_pack', {
      items: [evidenceOf('ws-agg-c', note, 'ev-pack-only')],
    });
    const set = writeDraft(service, 'claim_set', {
      items: [hypothesisClaim('ws-agg-a', 'claim-set-only')],
    });
    const lookup = service.createLookup(SESSION_ID);
    expect(lookup.getEvidence('ev-pack-only')).toMatchObject({ evidenceId: 'ev-pack-only' });
    expect(lookup.getClaim('claim-set-only')).toMatchObject({ claimId: 'claim-set-only' });
    expect(writeDraft(service, 'experiment', recordedExperiment({
      experimentId: 'exp-pack-verify',
      hypothesisClaimId: 'claim-set-only',
      baselineWorldStateId: 'ws-agg-a',
      variantWorldStateId: 'ws-agg-b',
      restoredWorldStateId: 'ws-agg-c',
      verifyEvidenceIds: ['ev-pack-only'],
    })).manifest.kind).toBe('experiment');
    expect(writeDraft(service, 'claim', {
      ...hypothesisClaim('ws-agg-a', 'claim-supports-set'),
      supports: ['claim-set-only'],
    }).manifest.kind).toBe('claim');
    expect(writeDraft(service, 'claim', {
      ...hypothesisClaim('ws-agg-a', 'claim-contradicts-set'),
      contradicts: ['claim-set-only'],
    }).manifest.kind).toBe('claim');
    const source = service.createLookup(SESSION_ID).getClaim('claim-set-only');
    expect(source).toBeTruthy();
    if (!source) throw new Error('expected live ClaimSet member');
    expect(writeDraft(service, 'report', sampleReport({
      claims: [{
        ...hypothesisClaim('ws-agg-a', 'claim-report-from-set'),
        projectionKind: 'report',
        compactProvenance: [{
          sourceClaimId: source.claimId,
          sourceEpistemicStatus: source.epistemic,
          sourceVerificationLevel: source.verification,
        }],
      }],
      evidenceIds: ['ev-pack-only'],
    })).manifest.kind).toBe('report');
    writeDraft(service, 'claim_set', {
      items: [hypothesisClaim('ws-agg-a', 'claim-set-v2')],
    }, { supersedes: set.manifest.artifactId });
    writeDraft(service, 'evidence_pack', {
      items: [evidenceOf('ws-agg-c', note, 'ev-pack-v2')],
    }, { supersedes: packed.manifest.artifactId });
    const after = service.createLookup(SESSION_ID);
    expect(after.getClaim('claim-set-only')).toBeNull();
    expect(after.getClaim('claim-set-v2')).toMatchObject({ claimId: 'claim-set-v2' });
    expect(after.getEvidence('ev-pack-only')).toBeNull();
    expect(after.getEvidence('ev-pack-v2')).toMatchObject({ evidenceId: 'ev-pack-v2' });
    expect(() => writeDraft(service, 'claim', {
      ...hypothesisClaim('ws-agg-a', 'claim-uses-old-set'),
      supports: ['claim-set-only'],
    })).toThrow(/INVESTIGATION_REF_UNRESOLVED/);
    expect(() => writeDraft(service, 'experiment', recordedExperiment({
      experimentId: 'exp-old-pack',
      hypothesisClaimId: 'claim-set-v2',
      baselineWorldStateId: 'ws-agg-a',
      variantWorldStateId: 'ws-agg-b',
      restoredWorldStateId: 'ws-agg-c',
      verifyEvidenceIds: ['ev-pack-only'],
    }))).toThrow(/INVESTIGATION_REF_UNRESOLVED/);
  });

  it('P1-A does not mark existing evidence stale when mutate write fails validation', () => {
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    const world = writeDraft(service, 'world_state', baselineWorld('ws-p1a'));
    const evidence = writeDraft(service, 'evidence', evidenceOf('ws-p1a', note, 'ev-p1a'));
    expect(evidence.record).toMatchObject({ stale: false });
    const polluted = {
      ...exclusiveWorld('ws-p1a', true),
      replay: { adapter: 'vk', driver: 'adreno', device: 'device-0', exclusiveLock: false },
    };
    expect(() => writeDraft(service, 'world_state', polluted, { artifactId: world.manifest.artifactId }))
      .toThrow(/INVESTIGATION_DUPLICATE_ID/);
    expect(service.readRecord(SESSION_ID, evidence.manifest.artifactId).record).toMatchObject({ stale: false });
    expect(service.readRecord(SESSION_ID, evidence.manifest.artifactId).manifest.status).not.toBe('stale');
    expect(() => service.writeRecord(SESSION_ID, {
      kind: 'world_state',
      mission: 'debugger',
      title: 'ready mutate fail',
      summary: 'must not stale existing evidence',
      record: polluted,
      supersedes: world.manifest.artifactId,
      status: 'ready',
      sourceRefs: [],
    })).toThrow(/INVESTIGATION_READY_DENIED/);
    const afterReadyFail = service.readRecord(SESSION_ID, evidence.manifest.artifactId);
    expect(afterReadyFail.record).toMatchObject({ stale: false });
    expect(afterReadyFail.manifest.status).not.toBe('stale');
    expect(service.readRecord(SESSION_ID, world.manifest.artifactId).manifest.status).toBe('draft');
  });

  it('P1-B fail-closes when index remaps artifact A onto B', () => {
    const { sessionPath, service } = createInvestigationHarness();
    const first = writeDraft(service, 'world_state', baselineWorld('ws-idx-a'));
    const second = writeDraft(service, 'world_state', baselineWorld('ws-idx-b'));
    const raw = JSON.parse(readFileSync(indexPath(sessionPath), 'utf8')) as {
      artifacts: Array<Record<string, unknown>>;
    };
    const mapped = raw.artifacts.find((entry) => entry.artifactId === first.manifest.artifactId);
    const target = raw.artifacts.find((entry) => entry.artifactId === second.manifest.artifactId);
    expect(mapped && target).toBeTruthy();
    if (!mapped || !target) throw new Error('expected both index entries');
    mapped.contentUri = target.contentUri;
    mapped.manifestUri = target.manifestUri;
    mapped.contentHash = target.contentHash;
    mapped.recordKey = target.recordKey;
    writeFileSync(indexPath(sessionPath), `${JSON.stringify(raw)}\n`, 'utf8');
    expect(() => service.readRecord(SESSION_ID, first.manifest.artifactId)).toThrow(/INVESTIGATION_INDEX_CORRUPT/);
    expect(() => service.list(SESSION_ID)).toThrow(/INVESTIGATION_INDEX_CORRUPT/);
  });

  it('P1-C requires supersedes for composite record ids', () => {
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    writeDraft(service, 'world_state', baselineWorld('ws-comp'));
    const claim = writeDraft(service, 'claim', observedClaim('ws-comp', 'claim-owned'));
    const evidence = writeDraft(service, 'evidence', evidenceOf('ws-comp', note, 'ev-owned'));
    expect(() => writeDraft(service, 'evidence_pack', {
      items: [evidenceOf('ws-comp', note, 'ev-owned')],
    })).toThrow(/INVESTIGATION_DUPLICATE_ID/);
    expect(() => writeDraft(service, 'evidence_pack', {
      items: [evidenceOf('ws-comp', note, 'ev-dup'), evidenceOf('ws-comp', note, 'ev-dup')],
    })).toThrow(/INVESTIGATION_DUPLICATE_ID/);
    expect(() => writeDraft(service, 'claim_set', {
      items: [hypothesisClaim('ws-comp', 'claim-owned')],
    })).toThrow(/INVESTIGATION_DUPLICATE_ID/);
    const projected = (claimId: string): ClaimRecord => ({
      ...(claim.record as ClaimRecord),
      claimId,
      projectionKind: 'report',
      compactProvenance: [{
        sourceClaimId: (claim.record as ClaimRecord).claimId,
        sourceEpistemicStatus: (claim.record as ClaimRecord).epistemic,
        sourceVerificationLevel: (claim.record as ClaimRecord).verification,
      }],
    });
    const cited = writeDraft(service, 'report', sampleReport({
      claims: [projected('claim-owned')],
      evidenceIds: ['ev-owned'],
    }));
    expect(cited.manifest.supersedes).toBeUndefined();
    expect(service.createLookup(SESSION_ID).getClaim('claim-owned')).toMatchObject({ claimId: 'claim-owned' });
    const report = writeDraft(service, 'report', sampleReport({
      claims: [projected('claim-report-1')],
      evidenceIds: ['ev-owned'],
    }));
    const shared = writeDraft(service, 'report', sampleReport({
      claims: [projected('claim-report-2')],
      evidenceIds: ['ev-owned'],
    }));
    expect(shared.manifest.kind).toBe('report');
    const replaced = writeDraft(service, 'report', sampleReport({
      claims: [projected('claim-report-3')],
      evidenceIds: ['ev-owned'],
    }), { supersedes: report.manifest.artifactId });
    expect(replaced.supersededArtifactId).toBe(report.manifest.artifactId);
    const packed = writeDraft(service, 'evidence_pack', {
      items: [evidenceOf('ws-comp', note, 'ev-owned')],
    }, { supersedes: evidence.manifest.artifactId });
    expect(packed.supersededArtifactId).toBe(evidence.manifest.artifactId);
  });

  it('P1-D closes evidence claimIds/contentHashes and claim supports/contradicts', () => {
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    writeDraft(service, 'world_state', baselineWorld('ws-refs'));
    const claim = writeDraft(service, 'claim', observedClaim('ws-refs', 'claim-target'));
    expect(writeDraft(service, 'evidence', {
      ...evidenceOf('ws-refs', note, 'ev-linked'),
      claimIds: ['claim-target'],
    }).manifest.kind).toBe('evidence');
    expect(writeDraft(service, 'claim', {
      ...hypothesisClaim('ws-refs', 'claim-supports'),
      supports: ['claim-target'],
    }).manifest.kind).toBe('claim');
    expect(writeDraft(service, 'claim', {
      ...hypothesisClaim('ws-refs', 'claim-contradicts'),
      contradicts: ['claim-target'],
    }).manifest.kind).toBe('claim');
    expect(() => writeDraft(service, 'evidence', {
      ...evidenceOf('ws-refs', note, 'ev-ghost-claim'),
      claimIds: ['claim-ghost'],
    })).toThrow(/INVESTIGATION_REF_UNRESOLVED/);
    expect(() => writeDraft(service, 'evidence', {
      ...evidenceOf('ws-refs', note, 'ev-hash-mismatch'),
      contentHashes: ['sha256:deadbeefdeadbeefdeadbeefdeadbeef'],
    })).toThrow(/INVESTIGATION_HASH_MISMATCH/);
    expect(() => writeDraft(service, 'evidence', {
      ...evidenceOf('ws-refs', note, 'ev-hash-len'),
      contentHashes: [],
    })).toThrow(/INVESTIGATION_HASH_MISMATCH/);
    expect(() => writeDraft(service, 'claim', {
      ...hypothesisClaim('ws-refs', 'claim-ghost-sup'),
      supports: ['claim-does-not-exist'],
    })).toThrow(/INVESTIGATION_REF_UNRESOLVED/);
    expect(() => writeDraft(service, 'claim', {
      ...hypothesisClaim('ws-refs', 'claim-self'),
      supports: ['claim-self'],
    })).toThrow(/INVESTIGATION_REF_UNRESOLVED/);
    expect(() => writeDraft(service, 'claim', {
      ...hypothesisClaim('ws-refs', 'claim-ghost-con'),
      contradicts: ['claim-does-not-exist'],
    })).toThrow(/INVESTIGATION_REF_UNRESOLVED/);
    expect(claim.manifest.kind).toBe('claim');
  });

  it('P1-E historical record ids require supersedes after replace', () => {
    const { service } = createInvestigationHarness();
    writeDraft(service, 'world_state', baselineWorld('ws-hist'));
    const first = writeDraft(service, 'claim', observedClaim('ws-hist', 'C1'));
    const latest = writeDraft(service, 'claim', observedClaim('ws-hist', 'C2'), {
      supersedes: first.manifest.artifactId,
    });
    expect(() => writeDraft(service, 'claim', observedClaim('ws-hist', 'C1')))
      .toThrow(/INVESTIGATION_DUPLICATE_ID/);
    const reused = writeDraft(service, 'claim', observedClaim('ws-hist', 'C1'), {
      supersedes: latest.manifest.artifactId,
    });
    expect(reused.supersededArtifactId).toBe(latest.manifest.artifactId);
    expect(service.createLookup(SESSION_ID).getClaim('C1')).toMatchObject({ claimId: 'C1' });
  });

  it('P1-F resolves live pack and set members through lookup', () => {
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    writeDraft(service, 'world_state', baselineWorld('ws-a'));
    writeDraft(service, 'world_state', exclusiveWorld('ws-b'));
    writeDraft(service, 'world_state', baselineWorld('ws-c'));
    const set = writeDraft(service, 'claim_set', { items: [hypothesisClaim('ws-a', 'claim-set-only')] });
    const pack = writeDraft(service, 'evidence_pack', { items: [evidenceOf('ws-c', note, 'ev-pack-only')] });
    const lookup = service.createLookup(SESSION_ID);
    expect(lookup.getClaim('claim-set-only')).toMatchObject({ claimId: 'claim-set-only' });
    expect(lookup.getEvidence('ev-pack-only')).toMatchObject({ evidenceId: 'ev-pack-only' });
    expect(writeDraft(service, 'experiment', recordedExperiment({
      experimentId: 'exp-pack-verify',
      hypothesisClaimId: 'claim-set-only',
      baselineWorldStateId: 'ws-a',
      variantWorldStateId: 'ws-b',
      restoredWorldStateId: 'ws-c',
      verifyEvidenceIds: ['ev-pack-only'],
    })).manifest.kind).toBe('experiment');
    expect(writeDraft(service, 'claim', {
      ...observedClaim('ws-a', 'claim-supports-set'),
      supports: ['claim-set-only'],
    }).manifest.kind).toBe('claim');
    expect(writeDraft(service, 'claim', {
      ...observedClaim('ws-a', 'claim-contradicts-set'),
      contradicts: ['claim-set-only'],
    }).manifest.kind).toBe('claim');
    const projected: ClaimRecord = {
      ...hypothesisClaim('ws-a', 'claim-report-from-set'),
      projectionKind: 'report',
      compactProvenance: [{
        sourceClaimId: 'claim-set-only',
        sourceEpistemicStatus: 'inferred',
        sourceVerificationLevel: 'reconstructed',
      }],
    };
    expect(writeDraft(service, 'report', sampleReport({
      claims: [projected],
      evidenceIds: ['ev-pack-only'],
    })).manifest.kind).toBe('report');
    writeDraft(service, 'claim_set', { items: [hypothesisClaim('ws-a', 'claim-set-v2')] }, {
      supersedes: set.manifest.artifactId,
    });
    writeDraft(service, 'evidence_pack', { items: [evidenceOf('ws-c', note, 'ev-pack-v2')] }, {
      supersedes: pack.manifest.artifactId,
    });
    const after = service.createLookup(SESSION_ID);
    expect(after.getClaim('claim-set-only')).toBeNull();
    expect(after.getEvidence('ev-pack-only')).toBeNull();
    expect(after.getClaim('claim-set-v2')).toMatchObject({ claimId: 'claim-set-v2' });
    expect(after.getEvidence('ev-pack-v2')).toMatchObject({ evidenceId: 'ev-pack-v2' });
    expect(() => writeDraft(service, 'claim', {
      ...observedClaim('ws-a', 'claim-stale-set-ref'),
      supports: ['claim-set-only'],
    })).toThrow(/INVESTIGATION_REF_UNRESOLVED/);
  });

  it('P1-1 marks EvidencePack members stale when bound WorldState is polluted', () => {
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    const world = writeDraft(service, 'world_state', baselineWorld('ws-pack-stale'));
    const pack = writeDraft(service, 'evidence_pack', {
      items: [evidenceOf('ws-pack-stale', note, 'ev-pack-member')],
    });
    expect(pack.record).toMatchObject({
      items: [expect.objectContaining({ evidenceId: 'ev-pack-member', stale: false })],
    });
    const polluted = writeDraft(service, 'world_state', {
      ...exclusiveWorld('ws-pack-stale', true),
      replay: { adapter: 'vk', driver: 'adreno', device: 'device-0', exclusiveLock: false },
    }, { supersedes: world.manifest.artifactId });
    expect(polluted.record).toMatchObject({ validity: 'polluted' });
    const reread = service.readRecord(SESSION_ID, pack.manifest.artifactId);
    expect(reread.record).toMatchObject({
      items: [expect.objectContaining({ evidenceId: 'ev-pack-member', stale: true })],
    });
    expect(reread.manifest.contentHash).toBe(reread.contentHash);
    const listed = service.list(SESSION_ID).find((entry) => entry.artifactId === pack.manifest.artifactId);
    expect(listed?.contentHash).toBe(reread.contentHash);
    expect(listed?.status).toBe('stale');
    expect(reread.manifest.status).toBe('stale');
    expect(service.createLookup(SESSION_ID).getEvidence('ev-pack-member')).toMatchObject({ stale: true });
  });

  it('P1-2 rejects observed_fact Claim with unresolved experimentId', () => {
    const { service } = createInvestigationHarness();
    writeDraft(service, 'world_state', baselineWorld('ws-obs-exp'));
    expect(() => writeDraft(service, 'claim', {
      ...observedClaim('ws-obs-exp', 'claim-ghost-exp'),
      experimentId: 'exp-ghost',
    })).toThrow(/INVESTIGATION_REF_UNRESOLVED/);
  });

  it('P1-1 ready claim becomes stale when source evidence hash changes', () => {
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    const world = writeDraft(service, 'world_state', baselineWorld('ws-ready-src'));
    const evidence = writeDraft(service, 'evidence', evidenceOf('ws-ready-src', note, 'ev-ready-src'));
    const claim = service.writeRecord(SESSION_ID, {
      kind: 'claim',
      mission: 'debugger',
      title: 'ready claim',
      summary: 'depends on evidence hash',
      record: observedClaim('ws-ready-src', 'claim-ready-src'),
      sourceRefs: [{ artifactId: evidence.manifest.artifactId, expectedHash: evidence.contentHash }],
      status: 'ready',
    });
    expect(claim.manifest.status).toBe('ready');
    const polluted = writeDraft(service, 'world_state', {
      ...exclusiveWorld('ws-ready-src', true),
      replay: { adapter: 'vk', driver: 'adreno', device: 'device-0', exclusiveLock: false },
    }, { supersedes: world.manifest.artifactId });
    expect(polluted.record).toMatchObject({ validity: 'polluted' });
    const evidenceAfter = service.readRecord(SESSION_ID, evidence.manifest.artifactId);
    expect(evidenceAfter.manifest.status).toBe('stale');
    expect(evidenceAfter.contentHash).not.toBe(evidence.contentHash);
    const claimAfter = service.readRecord(SESSION_ID, claim.manifest.artifactId);
    expect(claimAfter.manifest.status).not.toBe('ready');
    expect(claimAfter.manifest.status).toBe('stale');
  });

  it('P1-2 index status contentHash createdAt supersedes must match manifest', () => {
    const { sessionPath, service } = createInvestigationHarness();
    const first = writeDraft(service, 'world_state', baselineWorld('ws-idx-status'));
    writeDraft(service, 'world_state', baselineWorld('ws-idx-status'), {
      supersedes: first.manifest.artifactId,
    });
    expect(service.readRecord(SESSION_ID, first.manifest.artifactId).manifest.status).toBe('superseded');
    const raw = JSON.parse(readFileSync(indexPath(sessionPath), 'utf8')) as {
      artifacts: Array<Record<string, unknown>>;
    };
    const superseded = raw.artifacts.find((entry) => entry.artifactId === first.manifest.artifactId);
    expect(superseded).toBeTruthy();
    if (!superseded) throw new Error('expected superseded index entry');
    superseded.status = 'ready';
    writeFileSync(indexPath(sessionPath), `${JSON.stringify(raw)}\n`, 'utf8');
    expect(() => service.list(SESSION_ID)).toThrow(/INVESTIGATION_INDEX_CORRUPT/);
    expect(() => service.readRecord(SESSION_ID, first.manifest.artifactId)).toThrow(/INVESTIGATION_INDEX_CORRUPT/);
    expect(() => service.createLookup(SESSION_ID).getWorldState('ws-idx-status')).toThrow(/INVESTIGATION_INDEX_CORRUPT/);
  });

  it('P1-3 two reports may share the same evidence and experiment ids', () => {
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    writeDraft(service, 'world_state', baselineWorld('ws-rep-a'));
    writeDraft(service, 'world_state', exclusiveWorld('ws-rep-b'));
    writeDraft(service, 'world_state', baselineWorld('ws-rep-c'));
    const source = writeDraft(service, 'claim', observedClaim('ws-rep-a', 'claim-rep-src'));
    writeDraft(service, 'evidence', evidenceOf('ws-rep-c', note, 'ev-shared'));
    writeDraft(service, 'experiment', recordedExperiment({
      experimentId: 'exp-shared',
      hypothesisClaimId: 'claim-rep-src',
      baselineWorldStateId: 'ws-rep-a',
      variantWorldStateId: 'ws-rep-b',
      restoredWorldStateId: 'ws-rep-c',
      verifyEvidenceIds: ['ev-shared'],
    }));
    const projected = (claimId: string): ClaimRecord => ({
      ...(source.record as ClaimRecord),
      claimId,
      projectionKind: 'report',
      compactProvenance: [{
        sourceClaimId: (source.record as ClaimRecord).claimId,
        sourceEpistemicStatus: (source.record as ClaimRecord).epistemic,
        sourceVerificationLevel: (source.record as ClaimRecord).verification,
      }],
    });
    const first = writeDraft(service, 'report', sampleReport({
      claims: [projected('claim-rep-a')],
      evidenceIds: ['ev-shared'],
      experimentIds: ['exp-shared'],
    }));
    const second = writeDraft(service, 'report', sampleReport({
      claims: [projected('claim-rep-b')],
      evidenceIds: ['ev-shared'],
      experimentIds: ['exp-shared'],
    }));
    expect(first.manifest.kind).toBe('report');
    expect(second.manifest.kind).toBe('report');
    expect(first.record).toMatchObject({ evidenceIds: ['ev-shared'], experimentIds: ['exp-shared'] });
    expect(second.record).toMatchObject({ evidenceIds: ['ev-shared'], experimentIds: ['exp-shared'] });
  });

  it('P1-4 manifest worldStateId must resolve and match the record body', () => {
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    const world = writeDraft(service, 'world_state', baselineWorld('ws-bound'));
    writeDraft(service, 'world_state', baselineWorld('ws-other'));
    expect(() => writeDraft(service, 'claim', observedClaim('ws-bound'), {
      worldStateId: 'ws-missing',
    })).toThrow(/INVESTIGATION_REF_UNRESOLVED|INVESTIGATION_READY_DENIED/);
    expect(() => writeDraft(service, 'claim', observedClaim('ws-bound'), {
      worldStateId: 'ws-other',
    })).toThrow(/INVESTIGATION_REF_UNRESOLVED|INVESTIGATION_READY_DENIED/);
    expect(() => writeDraft(service, 'evidence', evidenceOf('ws-bound', note, 'ev-ghost-ws'), {
      worldStateId: 'ws-does-not-exist',
    })).toThrow(/INVESTIGATION_REF_UNRESOLVED|INVESTIGATION_READY_DENIED/);
    expect(() => service.writeRecord(SESSION_ID, {
      kind: 'claim',
      mission: 'debugger',
      title: 'ready mismatch',
      summary: 'must fail closed',
      record: observedClaim('ws-bound', 'claim-ready-mismatch'),
      worldStateId: 'ws-other',
      sourceRefs: [{ artifactId: world.manifest.artifactId, expectedHash: world.contentHash }],
      status: 'ready',
    })).toThrow(/INVESTIGATION_READY_DENIED|INVESTIGATION_REF_UNRESOLVED/);
    const aligned = writeDraft(service, 'claim', observedClaim('ws-bound', 'claim-aligned'), {
      worldStateId: 'ws-bound',
    });
    expect(aligned.manifest.worldStateId).toBe('ws-bound');
  });

  it('P1-5 WorldState validity stale marks bound evidence and pack members stale', () => {
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    const world = writeDraft(service, 'world_state', baselineWorld('ws-validity-stale'));
    const evidence = writeDraft(service, 'evidence', evidenceOf('ws-validity-stale', note, 'ev-vs'));
    const pack = writeDraft(service, 'evidence_pack', {
      items: [evidenceOf('ws-validity-stale', note, 'ev-vs-pack')],
    });
    expect(evidence.record).toMatchObject({ stale: false });
    const staleWorld = writeDraft(service, 'world_state', {
      ...baselineWorld('ws-validity-stale'),
      validity: 'stale',
    }, { supersedes: world.manifest.artifactId });
    expect(staleWorld.record).toMatchObject({ validity: 'stale' });
    const staleEvidence = service.readRecord(SESSION_ID, evidence.manifest.artifactId);
    expect(staleEvidence.record).toMatchObject({ stale: true });
    expect(staleEvidence.manifest.status).toBe('stale');
    const stalePack = service.readRecord(SESSION_ID, pack.manifest.artifactId);
    expect(stalePack.record).toMatchObject({
      items: [expect.objectContaining({ evidenceId: 'ev-vs-pack', stale: true })],
    });
    expect(stalePack.manifest.status).toBe('stale');
  });

  it('P1-1 lookup does not consume a tampered Experiment body with stale hashes', () => {
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    writeDraft(service, 'world_state', baselineWorld('ws-a'));
    const variant = writeDraft(service, 'world_state', exclusiveWorld('ws-b'));
    writeDraft(service, 'world_state', baselineWorld('ws-c'));
    writeDraft(service, 'claim', hypothesisClaim('ws-a'));
    writeDraft(service, 'evidence', evidenceOf('ws-c', note, 'ev-verify'));
    const experiment = writeDraft(service, 'experiment', recordedExperiment({
      experimentId: 'exp-tamper',
      hypothesisClaimId: 'claim-hyp',
      baselineWorldStateId: 'ws-a',
      variantWorldStateId: 'ws-b',
      restoredWorldStateId: 'ws-c',
      verifyEvidenceIds: ['ev-verify'],
    }));
    overwriteInvestigationRecordBody(resolver, experiment.manifest.artifactId, recordedExperiment({
      experimentId: 'exp-tamper',
      hypothesisClaimId: 'claim-hyp',
      baselineWorldStateId: 'ws-a',
      variantWorldStateId: 'ws-b',
      restoredWorldStateId: 'ws-c',
      verifyEvidenceIds: ['ev-verify'],
      interventionType: 'none',
    }));
    expect(() => service.list(SESSION_ID)).toThrow(/INVESTIGATION_HASH_MISMATCH|INVESTIGATION_INDEX_CORRUPT/);
    expect(() => service.readRecord(SESSION_ID, experiment.manifest.artifactId))
      .toThrow(/INVESTIGATION_HASH_MISMATCH|INVESTIGATION_INDEX_CORRUPT/);
    expect(() => service.createLookup(SESSION_ID).getExperiment('exp-tamper'))
      .toThrow(/INVESTIGATION_HASH_MISMATCH|INVESTIGATION_INDEX_CORRUPT/);
    expect(() => writeDraft(service, 'claim', {
      ...hypothesisClaim('ws-a', 'claim-causal-tamper'),
      claimKind: 'causal_conclusion',
      experimentId: 'exp-tamper',
      epistemic: 'derived',
      verification: 'replay_counterfactual',
    })).toThrow(/INVESTIGATION_HASH_MISMATCH|INVESTIGATION_INDEX_CORRUPT|S-CAUSAL-01/);
    expect(() => writeDraft(service, 'world_state', exclusiveWorld('ws-b', true), {
      supersedes: variant.manifest.artifactId,
    })).toThrow(/INVESTIGATION_HASH_MISMATCH|INVESTIGATION_INDEX_CORRUPT/);
  });

  it('P1-2 read rejects planted ready manifests with empty sourceRefs', () => {
    const { resolver, service } = createInvestigationHarness();
    const world = writeDraft(service, 'world_state', baselineWorld('ws-ready-empty'));
    forceReadyEmptySourceRefs(resolver, world.manifest.artifactId);
    expect(() => service.readRecord(SESSION_ID, world.manifest.artifactId))
      .toThrow(/INVESTIGATION_READY_DENIED|INVESTIGATION_INDEX_CORRUPT/);
    expect(() => service.list(SESSION_ID)).toThrow(/INVESTIGATION_READY_DENIED|INVESTIGATION_INDEX_CORRUPT/);
    expect(() => service.createLookup(SESSION_ID).getWorldState('ws-ready-empty'))
      .toThrow(/INVESTIGATION_READY_DENIED|INVESTIGATION_INDEX_CORRUPT/);
  });

  it('P1 read paths re-run record invariants after refs drift', () => {
    const drifted = /INVESTIGATION_HASH_MISMATCH|INVESTIGATION_REF_UNRESOLVED|S-CTX-01/;
    const evidenceCase = createInvestigationHarness();
    const note = seedNote(evidenceCase.resolver);
    writeDraft(evidenceCase.service, 'world_state', baselineWorld('ws-ctx'));
    const evidence = writeDraft(evidenceCase.service, 'evidence', evidenceOf('ws-ctx', note, 'ev-ctx'));
    expect(evidenceCase.service.readRecord(SESSION_ID, evidence.manifest.artifactId).record)
      .toMatchObject({ evidenceId: 'ev-ctx' });
    expect(evidenceCase.service.list(SESSION_ID, { kind: 'evidence' }).map((entry) => entry.artifactId))
      .toContain(evidence.manifest.artifactId);
    expect(evidenceCase.service.createLookup(SESSION_ID).getEvidence('ev-ctx'))
      .toMatchObject({ evidenceId: 'ev-ctx' });
    evidenceCase.resolver.write(SESSION_ID, note.uri, '{"note":"overwritten"}\n', { mimeType: 'application/json' });
    expect(() => evidenceCase.service.readRecord(SESSION_ID, evidence.manifest.artifactId)).toThrow(drifted);
    expect(() => evidenceCase.service.list(SESSION_ID, { kind: 'evidence' })).toThrow(drifted);
    expect(() => evidenceCase.service.list(SESSION_ID)).toThrow(drifted);
    expect(() => evidenceCase.service.createLookup(SESSION_ID).getEvidence('ev-ctx')).toThrow(drifted);
    expect(evidenceCase.service.list(SESSION_ID, { kind: 'world_state' })).toHaveLength(1);
    expect(evidenceCase.service.createLookup(SESSION_ID).getWorldState('ws-ctx'))
      .toMatchObject({ worldStateId: 'ws-ctx' });

    const claimCase = createInvestigationHarness();
    writeDraft(claimCase.service, 'world_state', baselineWorld('ws-claim-ctx'));
    const target = writeDraft(claimCase.service, 'claim', observedClaim('ws-claim-ctx', 'claim-target-ctx'));
    const supporter = writeDraft(claimCase.service, 'claim', {
      ...hypothesisClaim('ws-claim-ctx', 'claim-supports-ctx'),
      supports: ['claim-target-ctx'],
    });
    expect(claimCase.service.readRecord(SESSION_ID, supporter.manifest.artifactId).record)
      .toMatchObject({ claimId: 'claim-supports-ctx' });
    writeDraft(claimCase.service, 'claim', observedClaim('ws-claim-ctx', 'claim-target-v2'), {
      supersedes: target.manifest.artifactId,
    });
    expect(() => claimCase.service.readRecord(SESSION_ID, supporter.manifest.artifactId)).toThrow(drifted);
    expect(() => claimCase.service.list(SESSION_ID, { kind: 'claim' })).toThrow(drifted);
    expect(() => claimCase.service.createLookup(SESSION_ID).getClaim('claim-supports-ctx')).toThrow(drifted);
    expect(claimCase.service.createLookup(SESSION_ID).getClaim('claim-target-v2'))
      .toMatchObject({ claimId: 'claim-target-v2' });

    const experimentCase = createInvestigationHarness();
    const verifyNote = seedNote(experimentCase.resolver);
    writeDraft(experimentCase.service, 'world_state', baselineWorld('ws-a'));
    writeDraft(experimentCase.service, 'world_state', exclusiveWorld('ws-b'));
    writeDraft(experimentCase.service, 'world_state', baselineWorld('ws-c'));
    writeDraft(experimentCase.service, 'claim', hypothesisClaim('ws-a'));
    const verify = writeDraft(experimentCase.service, 'evidence', evidenceOf('ws-c', verifyNote, 'ev-verify-ctx'));
    const experiment = writeDraft(experimentCase.service, 'experiment', recordedExperiment({
      experimentId: 'exp-ctx',
      hypothesisClaimId: 'claim-hyp',
      baselineWorldStateId: 'ws-a',
      variantWorldStateId: 'ws-b',
      restoredWorldStateId: 'ws-c',
      verifyEvidenceIds: ['ev-verify-ctx'],
    }));
    expect(experimentCase.service.readRecord(SESSION_ID, experiment.manifest.artifactId).record)
      .toMatchObject({ experimentId: 'exp-ctx' });
    writeDraft(experimentCase.service, 'evidence', evidenceOf('ws-c', verifyNote, 'ev-verify-v2'), {
      supersedes: verify.manifest.artifactId,
    });
    expect(() => experimentCase.service.readRecord(SESSION_ID, experiment.manifest.artifactId)).toThrow(drifted);
    expect(() => experimentCase.service.list(SESSION_ID, { kind: 'experiment' })).toThrow(drifted);
    expect(() => experimentCase.service.createLookup(SESSION_ID).getExperiment('exp-ctx')).toThrow(drifted);
    expect(experimentCase.service.createLookup(SESSION_ID).getEvidence('ev-verify-v2'))
      .toMatchObject({ evidenceId: 'ev-verify-v2' });
  });

  it('P1 read rejects Experiment and causal Claim when verify Evidence artifact content drifts', () => {
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    writeDraft(service, 'world_state', baselineWorld('ws-a'));
    writeDraft(service, 'world_state', exclusiveWorld('ws-b'));
    writeDraft(service, 'world_state', baselineWorld('ws-c'));
    writeDraft(service, 'claim', hypothesisClaim('ws-a'));
    const evidence = writeDraft(service, 'evidence', evidenceOf('ws-c', note, 'ev-verify-drift'));
    const experiment = writeDraft(service, 'experiment', recordedExperiment({
      experimentId: 'exp-verify-drift',
      hypothesisClaimId: 'claim-hyp',
      baselineWorldStateId: 'ws-a',
      variantWorldStateId: 'ws-b',
      restoredWorldStateId: 'ws-c',
      verifyEvidenceIds: ['ev-verify-drift'],
    }));
    const causal = writeDraft(service, 'claim', {
      ...hypothesisClaim('ws-a', 'claim-causal-drift'),
      claimKind: 'causal_conclusion',
      experimentId: 'exp-verify-drift',
      epistemic: 'derived',
      verification: 'replay_counterfactual',
    });
    expect(service.readRecord(SESSION_ID, experiment.manifest.artifactId).record)
      .toMatchObject({ experimentId: 'exp-verify-drift', status: 'recorded' });
    expect(service.readRecord(SESSION_ID, causal.manifest.artifactId).record)
      .toMatchObject({ claimId: 'claim-causal-drift', experimentId: 'exp-verify-drift' });
    resolver.write(SESSION_ID, note.uri, '{"note":"drifted-without-updating-evidence"}\n', {
      mimeType: 'application/json',
    });
    const closed = /INVESTIGATION_HASH_MISMATCH|INVESTIGATION_REF_UNRESOLVED|S-CAUSAL-01|S-RDC-01|S-CTX-01/;
    expect(() => service.readRecord(SESSION_ID, evidence.manifest.artifactId)).toThrow(closed);
    expect(() => service.readRecord(SESSION_ID, experiment.manifest.artifactId)).toThrow(closed);
    expect(() => service.readRecord(SESSION_ID, causal.manifest.artifactId)).toThrow(closed);
    expect(() => service.list(SESSION_ID, { kind: 'experiment' })).toThrow(closed);
    expect(() => service.list(SESSION_ID, { kind: 'claim' })).toThrow(closed);
    expect(() => service.createLookup(SESSION_ID).getEvidence('ev-verify-drift')).toThrow(closed);
    expect(() => service.createLookup(SESSION_ID).getExperiment('exp-verify-drift')).toThrow(closed);
    expect(() => service.createLookup(SESSION_ID).getClaim('claim-causal-drift')).toThrow(closed);
  });

  it('P1-2 read rejects ready records whose worldStateId no longer binds', () => {
    const { resolver, service } = createInvestigationHarness();
    const world = writeDraft(service, 'world_state', baselineWorld('ws-bind-read'));
    const claim = service.writeRecord(SESSION_ID, {
      kind: 'claim',
      mission: 'debugger',
      title: 'ready bind',
      summary: 'will break worldState on disk',
      record: observedClaim('ws-bind-read', 'claim-bind-read'),
      sourceRefs: [{ artifactId: world.manifest.artifactId, expectedHash: world.contentHash }],
      status: 'ready',
    });
    expect(claim.manifest.status).toBe('ready');
    overwriteInvestigationManifest(resolver, claim.manifest.artifactId, { worldStateId: 'ws-ghost' });
    expect(() => service.readRecord(SESSION_ID, claim.manifest.artifactId))
      .toThrow(/INVESTIGATION_READY_DENIED|INVESTIGATION_INDEX_CORRUPT|INVESTIGATION_REF_UNRESOLVED/);
    expect(() => service.createLookup(SESSION_ID).getClaim('claim-bind-read'))
      .toThrow(/INVESTIGATION_READY_DENIED|INVESTIGATION_INDEX_CORRUPT|INVESTIGATION_REF_UNRESOLVED/);
  });

  it('P1 lookup does not return a cycle member after the root fails on the same lookup', () => {
    const { resolver, service } = createInvestigationHarness();
    writeDraft(service, 'world_state', baselineWorld('ws-cycle'));
    plantInvestigationRecord(resolver, {
      artifactId: 'art-claim-cycle',
      kind: 'claim',
      recordType: 'ClaimRecord',
      recordKey: 'claim-cycle',
      record: {
        ...hypothesisClaim('ws-cycle', 'claim-cycle'),
        experimentId: 'exp-cycle-root',
      },
    });
    plantInvestigationRecord(resolver, {
      artifactId: 'art-exp-cycle',
      kind: 'experiment',
      recordType: 'ExperimentRecord',
      recordKey: 'exp-cycle-root',
      record: recordedExperiment({
        experimentId: 'exp-cycle-root',
        hypothesisClaimId: 'claim-cycle',
        baselineWorldStateId: 'ws-cycle-missing',
        variantWorldStateId: 'ws-cycle',
        restoredWorldStateId: 'ws-cycle',
        verifyEvidenceIds: [],
      }),
    });
    const lookup = service.createLookup(SESSION_ID);
    expect(() => lookup.getExperiment('exp-cycle-root')).toThrow(/INVESTIGATION_REF_UNRESOLVED/);
    expect(() => lookup.getClaim('claim-cycle')).toThrow(/INVESTIGATION_REF_UNRESOLVED/);
  });
});
