import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_AGENT_TOOL_IDS,
  BUILTIN_AGENT_TOOL_TIERS,
  CANONICAL_TOOL_TOKEN_EXPANSIONS,
} from '@shared/constants/agentToolTokens';
import { AGENT_WORKBENCH_TOOL_CATALOG } from '@shared/constants/agentWorkbenchCatalog';
import {
  INVESTIGATION_KIND_REGISTRY,
  INVESTIGATION_SCHEMA_NAMESPACE,
  epistemicRank,
  isCausalOrCounterfactualClaim,
  type ClaimRecord,
} from '@shared/types/renderdocInvestigation';
import { InvestigationError } from '../investigation/investigationErrors';
import { createInvestigationTools } from '../investigation/InvestigationTools';
import {
  SESSION_ID,
  baselineWorld,
  createInvestigationHarness,
  derivedStructureClaim,
  evidenceOf,
  exclusiveWorld,
  forceReadyEmptySourceRefs,
  hypothesisClaim,
  observedClaim,
  overwriteInvestigationRecordBody,
  plantInvestigationRecord,
  recordedExperiment,
  sampleChallenge,
  sampleCheckpoint,
  sampleReport,
  sampleReportContract,
  seedNote,
  writeDraft,
} from '../investigation/investigationTestFixtures';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function readRepo(relative: string): string {
  return readFileSync(path.join(repoRoot, relative), 'utf8');
}

describe('investigation system contract', () => {
  it('investigation.contract.schema.namespace-fields', () => {
    expect.hasAssertions();
    expect(INVESTIGATION_SCHEMA_NAMESPACE).toBe('rdc.investigation.v1');
    const source = readRepo('src/shared/types/renderdocInvestigation.ts');
    expect(source).toMatch(/export (?:interface|type) WorldState/);
    expect(source).toMatch(/export (?:interface|type) EvidenceRecord/);
    expect(source).toMatch(/export (?:interface|type) ClaimRecord[\s\S]*claimId[\s\S]*experimentId/);
    expect(source).toMatch(/export (?:interface|type) ExperimentRecord[\s\S]*experimentId/);
    expect(source).toMatch(/export (?:interface|type) ChallengeRecord[\s\S]*challengeId/);
    expect(source).toMatch(/export (?:interface|type) MissionCheckpoint/);
    expect(source).toMatch(/export (?:interface|type) InvestigationArtifactManifest[\s\S]*artifactId/);
    expect(INVESTIGATION_KIND_REGISTRY.map((entry) => entry.kind)).toEqual([
      'world_state',
      'evidence',
      'evidence_pack',
      'claim',
      'claim_set',
      'experiment',
      'challenge',
      'checkpoint',
      'report',
    ]);
    const { service } = createInvestigationHarness();
    const written = writeDraft(service, 'world_state', baselineWorld());
    expect(written.manifest.recordType).toBe('WorldState');
    expect(written.record).toMatchObject({ worldStateId: 'ws-baseline' });
    expect(() => writeDraft(service, 'not_a_kind', { worldStateId: 'x' })).toThrow(InvestigationError);
    const tools = createInvestigationTools(SESSION_ID, { service });
    expect(tools.map((tool) => tool.name)).toEqual([
      'investigation_read',
      'investigation_write',
      'investigation_list',
    ]);
    expect(CANONICAL_TOOL_TOKEN_EXPANSIONS.investigation).toEqual([
      'investigation_read',
      'investigation_write',
      'investigation_list',
    ]);
    const workbench = new Set(AGENT_WORKBENCH_TOOL_CATALOG.map((tool) => tool.id));
    for (const id of CANONICAL_TOOL_TOKEN_EXPANSIONS.investigation) {
      expect(BUILTIN_AGENT_TOOL_IDS.includes(id as typeof BUILTIN_AGENT_TOOL_IDS[number])).toBe(true);
      expect(BUILTIN_AGENT_TOOL_TIERS[id as keyof typeof BUILTIN_AGENT_TOOL_TIERS]).toBe('extended');
      expect(workbench.has(id)).toBe(true);
    }
  });

  it('investigation.contract.ready.source-hash-schema', () => {
    expect.hasAssertions();
    const { service } = createInvestigationHarness();
    const source = writeDraft(service, 'world_state', baselineWorld());
    const ready = service.writeRecord(SESSION_ID, {
      kind: 'world_state',
      mission: 'debugger',
      title: 'Ready baseline',
      summary: 'Ready after source hash',
      record: baselineWorld('ws-ready'),
      sourceRefs: [{ artifactId: source.manifest.artifactId, expectedHash: source.contentHash }],
      status: 'ready',
    });
    expect(ready.manifest.status).toBe('ready');
    expect(ready.manifest.sourceRefs).toHaveLength(1);
    expect(() => service.writeRecord(SESSION_ID, {
      kind: 'world_state',
      mission: 'debugger',
      title: 'No sources',
      summary: 'ready without sourceRefs',
      record: baselineWorld('ws-nosrc'),
      sourceRefs: [],
      status: 'ready',
    })).toThrow(/INVESTIGATION_READY_DENIED/);
    expect(() => service.writeRecord(SESSION_ID, {
      kind: 'world_state',
      mission: 'debugger',
      title: 'Bad hash',
      summary: 'ready with wrong source hash',
      record: baselineWorld('ws-badhash'),
      sourceRefs: [{ artifactId: source.manifest.artifactId, expectedHash: 'sha256:deadbeefdeadbeefdeadbeefdeadbeef' }],
      status: 'ready',
    })).toThrow(/INVESTIGATION_HASH_MISMATCH|INVESTIGATION_REF_UNRESOLVED|INVESTIGATION_READY_DENIED/);
    expect(() => service.writeRecord(SESSION_ID, {
      kind: 'claim',
      mission: 'debugger',
      title: 'Invalid body',
      summary: 'cannot be ready',
      record: { claimId: 'broken' },
      sourceRefs: [{ artifactId: source.manifest.artifactId, expectedHash: source.contentHash }],
      status: 'ready',
    })).toThrow(/INVESTIGATION_SCHEMA_INVALID/);
    expect(() => service.writeRecord(SESSION_ID, {
      kind: 'ghost',
      mission: 'debugger',
      title: 'Unknown kind',
      summary: 'unregistered',
      record: baselineWorld(),
      status: 'ready',
    })).toThrow(/INVESTIGATION_KIND_UNKNOWN/);
    const { resolver, service: planted } = createInvestigationHarness();
    const disk = writeDraft(planted, 'world_state', baselineWorld('ws-planted-ready'));
    forceReadyEmptySourceRefs(resolver, disk.manifest.artifactId);
    expect(() => planted.readRecord(SESSION_ID, disk.manifest.artifactId))
      .toThrow(/INVESTIGATION_READY_DENIED|INVESTIGATION_INDEX_CORRUPT/);
    expect(() => planted.list(SESSION_ID)).toThrow(/INVESTIGATION_READY_DENIED|INVESTIGATION_INDEX_CORRUPT/);
  });

  it('investigation.contract.epistemic.order', () => {
    expect.hasAssertions();
    expect(epistemicRank('unknown')).toBe(0);
    expect(epistemicRank('inferred')).toBe(1);
    expect(epistemicRank('derived')).toBe(2);
    expect(epistemicRank('observed')).toBe(3);
    expect(epistemicRank('unknown') < epistemicRank('inferred')).toBe(true);
    const { resolver, service } = createInvestigationHarness();
    writeDraft(service, 'world_state', baselineWorld());
    const sourceClaim = writeDraft(service, 'claim', hypothesisClaim('ws-baseline'));
    const source = sourceClaim.record as ClaimRecord;
    const upgraded: ClaimRecord = {
      ...source,
      claimId: 'claim-upgraded',
      projectionKind: 'compact',
      epistemic: 'observed',
      compactProvenance: [{
        sourceClaimId: source.claimId,
        sourceEpistemicStatus: source.epistemic,
        sourceVerificationLevel: source.verification,
      }],
    };
    expect(() => writeDraft(service, 'claim', upgraded)).toThrow(/S-CLAIM-01|INVESTIGATION_INVARIANT_VIOLATION/);
    const legal: ClaimRecord = {
      ...source,
      claimId: 'claim-compact',
      projectionKind: 'compact',
      epistemic: 'inferred',
      compactProvenance: [{
        sourceClaimId: source.claimId,
        sourceEpistemicStatus: source.epistemic,
        sourceVerificationLevel: source.verification,
      }],
    };
    const projected = writeDraft(service, 'claim', legal);
    expect((projected.record as ClaimRecord).epistemic).toBe('inferred');
    expect(resolver.read(SESSION_ID, projected.contentUri).text).toContain('claim-compact');
  });

  it('investigation.contract.s-claim.positive-negative', () => {
    expect.hasAssertions();
    const { service } = createInvestigationHarness();
    writeDraft(service, 'world_state', baselineWorld());
    const sourceClaim = writeDraft(service, 'claim', observedClaim('ws-baseline'));
    const source = sourceClaim.record as ClaimRecord;
    const positive: ClaimRecord = {
      ...source,
      claimId: 'claim-view',
      projectionKind: 'view',
      epistemic: 'derived',
      compactProvenance: [{
        sourceClaimId: source.claimId,
        sourceEpistemicStatus: source.epistemic,
        sourceVerificationLevel: source.verification,
      }],
    };
    expect(writeDraft(service, 'claim', positive).manifest.kind).toBe('claim');
    const missingProvenance: ClaimRecord = {
      ...source,
      claimId: 'claim-missing',
      projectionKind: 'report',
      compactProvenance: null,
    };
    expect(() => writeDraft(service, 'claim', missingProvenance)).toThrow(/S-CLAIM-01|compactProvenance/);
    const mismatch: ClaimRecord = {
      ...source,
      claimId: 'claim-mismatch',
      projectionKind: 'compact',
      compactProvenance: [{
        sourceClaimId: source.claimId,
        sourceEpistemicStatus: 'unknown',
        sourceVerificationLevel: source.verification,
      }],
    };
    expect(() => writeDraft(service, 'claim', mismatch)).toThrow(/S-CLAIM-01|INVESTIGATION_INVARIANT_VIOLATION/);
    const missingSource: ClaimRecord = {
      ...source,
      claimId: 'claim-ghost',
      projectionKind: 'compact',
      compactProvenance: [{
        sourceClaimId: 'claim-does-not-exist',
        sourceEpistemicStatus: 'observed',
        sourceVerificationLevel: 'observed',
      }],
    };
    expect(() => writeDraft(service, 'claim', missingSource)).toThrow(/S-CLAIM-01|INVESTIGATION_INVARIANT_VIOLATION/);
    const reportClaim: ClaimRecord = {
      ...source,
      claimId: 'claim-in-report',
      projectionKind: null,
      compactProvenance: null,
    };
    expect(() => service.writeRecord(SESSION_ID, {
      kind: 'report',
      mission: 'debugger',
      title: 'No provenance',
      summary: 'report claim must be projected',
      record: sampleReport({ claims: [reportClaim] }),
      sourceRefs: [{ artifactId: sourceClaim.manifest.artifactId, expectedHash: sourceClaim.contentHash }],
      status: 'ready',
    })).toThrow(/S-CLAIM-01|compactProvenance|INVESTIGATION_INVARIANT_VIOLATION/);
  });

  it('investigation.contract.s-causal.positive-negative', { timeout: 15_000 }, () => {
    expect.hasAssertions();
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    writeDraft(service, 'world_state', baselineWorld('ws-a'));
    writeDraft(service, 'world_state', exclusiveWorld('ws-b'));
    writeDraft(service, 'world_state', baselineWorld('ws-c'));
    const hyp = writeDraft(service, 'claim', hypothesisClaim('ws-a'));
    const verify = writeDraft(service, 'evidence', evidenceOf('ws-c', note, 'ev-verify'));
    writeDraft(service, 'experiment', recordedExperiment({
      hypothesisClaimId: (hyp.record as ClaimRecord).claimId,
      baselineWorldStateId: 'ws-a',
      variantWorldStateId: 'ws-b',
      restoredWorldStateId: 'ws-c',
      verifyEvidenceIds: ['ev-verify'],
    }));
    expect(verify.manifest.kind).toBe('evidence');
    const causal: ClaimRecord = {
      ...hypothesisClaim('ws-a', 'claim-causal'),
      claimKind: 'causal_conclusion',
      experimentId: 'exp-1',
      declaresCounterfactual: false,
      epistemic: 'derived',
      verification: 'replay_counterfactual',
    };
    expect(isCausalOrCounterfactualClaim(causal)).toBe(true);
    expect(writeDraft(service, 'claim', causal).record).toMatchObject({ experimentId: 'exp-1' });
    expect(() => writeDraft(service, 'claim', {
      ...causal,
      claimId: 'claim-none',
      experimentId: (writeDraft(service, 'experiment', recordedExperiment({
        experimentId: 'exp-none',
        hypothesisClaimId: (hyp.record as ClaimRecord).claimId,
        baselineWorldStateId: 'ws-a',
        variantWorldStateId: 'ws-b',
        restoredWorldStateId: 'ws-c',
        verifyEvidenceIds: ['ev-verify'],
        interventionType: 'none',
      })), 'exp-none'),
    })).toThrow(/S-CAUSAL-01/);
    expect(() => writeDraft(service, 'claim', {
      ...causal,
      claimId: 'claim-unresolved',
      experimentId: 'exp-missing',
    })).toThrow(/S-CAUSAL-01|INVESTIGATION_REF_UNRESOLVED/);
    expect(() => writeDraft(service, 'claim', {
      ...causal,
      claimId: 'claim-norestore',
      experimentId: (writeDraft(service, 'experiment', recordedExperiment({
        experimentId: 'exp-norestore',
        hypothesisClaimId: (hyp.record as ClaimRecord).claimId,
        baselineWorldStateId: 'ws-a',
        variantWorldStateId: 'ws-b',
        restoredWorldStateId: 'ws-c',
        verifyEvidenceIds: ['ev-verify'],
        baselineRestored: false,
      })), 'exp-norestore'),
    })).toThrow(/S-CAUSAL-01|S-RDC-01/);
    const forged = writeDraft(service, 'experiment', recordedExperiment({
      experimentId: 'exp-forged-hash',
      hypothesisClaimId: (hyp.record as ClaimRecord).claimId,
      baselineWorldStateId: 'ws-a',
      variantWorldStateId: 'ws-b',
      restoredWorldStateId: 'ws-c',
      verifyEvidenceIds: ['ev-verify'],
    }));
    overwriteInvestigationRecordBody(resolver, forged.manifest.artifactId, recordedExperiment({
      experimentId: 'exp-forged-hash',
      hypothesisClaimId: (hyp.record as ClaimRecord).claimId,
      baselineWorldStateId: 'ws-a',
      variantWorldStateId: 'ws-b',
      restoredWorldStateId: 'ws-c',
      verifyEvidenceIds: ['ev-verify'],
      interventionType: 'none',
    }));
    expect(() => service.createLookup(SESSION_ID).getExperiment('exp-forged-hash'))
      .toThrow(/INVESTIGATION_HASH_MISMATCH|INVESTIGATION_INDEX_CORRUPT/);
    expect(() => writeDraft(service, 'claim', {
      ...causal,
      claimId: 'claim-forged-hash',
      experimentId: 'exp-forged-hash',
    })).toThrow(/INVESTIGATION_HASH_MISMATCH|INVESTIGATION_INDEX_CORRUPT|S-CAUSAL-01/);
    const driftCase = createInvestigationHarness();
    const driftNote = seedNote(driftCase.resolver);
    writeDraft(driftCase.service, 'world_state', baselineWorld('ws-a'));
    writeDraft(driftCase.service, 'world_state', exclusiveWorld('ws-b'));
    writeDraft(driftCase.service, 'world_state', baselineWorld('ws-c'));
    writeDraft(driftCase.service, 'claim', hypothesisClaim('ws-a'));
    writeDraft(driftCase.service, 'evidence', evidenceOf('ws-c', driftNote, 'ev-verify'));
    writeDraft(driftCase.service, 'experiment', recordedExperiment({
      hypothesisClaimId: 'claim-hyp',
      baselineWorldStateId: 'ws-a',
      variantWorldStateId: 'ws-b',
      restoredWorldStateId: 'ws-c',
      verifyEvidenceIds: ['ev-verify'],
    }));
    const liveCausal = writeDraft(driftCase.service, 'claim', {
      ...causal,
      claimId: 'claim-verify-drift',
    });
    driftCase.resolver.write(SESSION_ID, driftNote.uri, '{"note":"verify-evidence-drifted"}\n', {
      mimeType: 'application/json',
    });
    const drifted = /INVESTIGATION_HASH_MISMATCH|INVESTIGATION_REF_UNRESOLVED|S-CAUSAL-01|S-RDC-01/;
    expect(() => driftCase.service.readRecord(SESSION_ID, liveCausal.manifest.artifactId)).toThrow(drifted);
    expect(() => driftCase.service.createLookup(SESSION_ID).getExperiment('exp-1')).toThrow(drifted);
    expect(() => driftCase.service.createLookup(SESSION_ID).getClaim('claim-verify-drift')).toThrow(drifted);
  });

  it('investigation.contract.s-ctx.read-invariants', () => {
    expect.hasAssertions();
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    writeDraft(service, 'world_state', baselineWorld('ws-sctx'));
    const evidence = writeDraft(service, 'evidence', evidenceOf('ws-sctx', note, 'ev-sctx'));
    expect(service.readRecord(SESSION_ID, evidence.manifest.artifactId).record).toMatchObject({
      evidenceId: 'ev-sctx',
      contentHashes: [note.hash],
    });
    resolver.write(SESSION_ID, note.uri, '{"note":"mutated-after-write"}\n', { mimeType: 'application/json' });
    const closed = /INVESTIGATION_HASH_MISMATCH|INVESTIGATION_REF_UNRESOLVED|S-CTX-01/;
    expect(() => service.readRecord(SESSION_ID, evidence.manifest.artifactId)).toThrow(closed);
    expect(() => service.list(SESSION_ID, { kind: 'evidence' })).toThrow(closed);
    expect(() => service.createLookup(SESSION_ID).getEvidence('ev-sctx')).toThrow(closed);
  });

  it('investigation.contract.s-causal.ready-denied-without-experiment', () => {
    expect.hasAssertions();
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    const world = writeDraft(service, 'world_state', baselineWorld('ws-a'));
    writeDraft(service, 'world_state', exclusiveWorld('ws-b'));
    writeDraft(service, 'world_state', baselineWorld('ws-c'));
    writeDraft(service, 'claim', hypothesisClaim('ws-a'));
    writeDraft(service, 'evidence', evidenceOf('ws-c', note, 'ev-verify'));
    const missingExperiment: ClaimRecord = {
      ...hypothesisClaim('ws-a', 'claim-causal-ready'),
      claimKind: 'causal_conclusion',
      experimentId: null,
      declaresCounterfactual: false,
      epistemic: 'derived',
      verification: 'replay_counterfactual',
    };
    expect(() => service.writeRecord(SESSION_ID, {
      kind: 'claim',
      mission: 'debugger',
      title: 'Causal without experiment',
      summary: 'must not become ready',
      record: missingExperiment,
      sourceRefs: [{ artifactId: world.manifest.artifactId, expectedHash: world.contentHash }],
      status: 'ready',
    })).toThrow(/S-CAUSAL-01|experimentId|INVESTIGATION_SCHEMA_INVALID|INVESTIGATION_READY_DENIED/);
    writeDraft(service, 'experiment', recordedExperiment({
      experimentId: 'exp-designed',
      hypothesisClaimId: 'claim-hyp',
      baselineWorldStateId: 'ws-a',
      variantWorldStateId: 'ws-b',
      restoredWorldStateId: 'ws-c',
      verifyEvidenceIds: ['ev-verify'],
      status: 'designed',
    }));
    const designed: ClaimRecord = {
      ...missingExperiment,
      claimId: 'claim-designed-exp',
      experimentId: 'exp-designed',
    };
    expect(() => service.writeRecord(SESSION_ID, {
      kind: 'claim',
      mission: 'debugger',
      title: 'Causal on designed experiment',
      summary: 'must not become ready',
      record: designed,
      sourceRefs: [{ artifactId: world.manifest.artifactId, expectedHash: world.contentHash }],
      status: 'ready',
    })).toThrow(/S-CAUSAL-01|INVESTIGATION_READY_DENIED|INVESTIGATION_INVARIANT_VIOLATION/);
  });

  it('investigation.contract.skeptic.challenge-shape', () => {
    expect.hasAssertions();
    const { service } = createInvestigationHarness();
    writeDraft(service, 'world_state', baselineWorld());
    const hyp = writeDraft(service, 'claim', hypothesisClaim('ws-baseline'));
    const written = writeDraft(service, 'challenge', sampleChallenge({
      targetId: (hyp.record as ClaimRecord).claimId,
      requiredFollowUp: 'Sample the first diverging event color.',
    }));
    expect(written.manifest.kind).toBe('challenge');
    expect(written.record).toMatchObject({
      challengeId: 'ch-1',
      targetRef: { type: 'claim', id: 'claim-hyp' },
      challengeKind: 'missing_evidence',
      requiredFollowUp: 'Sample the first diverging event color.',
      status: 'open',
    });
    expect(() => writeDraft(service, 'challenge', sampleChallenge({
      challengeId: 'ch-ghost',
      targetId: 'claim-does-not-exist',
    }))).toThrow(/INVESTIGATION_REF_UNRESOLVED/);
    expect(() => writeDraft(service, 'challenge', sampleChallenge({
      challengeId: 'ch-resolved-gap',
      targetId: (hyp.record as ClaimRecord).claimId,
      status: 'resolved',
    }))).toThrow(/resolutionClaimId|INVESTIGATION_SCHEMA_INVALID/);
    const source = readRepo('resources/agent-runtime/skills/skeptic-review/SKILL.md');
    expect(source).toMatch(/ChallengeRecord/);
    expect(source).toMatch(/requiredFollowUp/);
    expect(source).toMatch(/task_create/);
  });

  it('investigation.contract.checkpoint.ids-resolvable', () => {
    expect.hasAssertions();
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    const world = writeDraft(service, 'world_state', baselineWorld('ws-a'));
    writeDraft(service, 'world_state', exclusiveWorld('ws-b'));
    writeDraft(service, 'world_state', baselineWorld('ws-c'));
    const hyp = writeDraft(service, 'claim', hypothesisClaim('ws-a'));
    writeDraft(service, 'evidence', evidenceOf('ws-c', note, 'ev-verify'));
    const experiment = writeDraft(service, 'experiment', recordedExperiment({
      hypothesisClaimId: (hyp.record as ClaimRecord).claimId,
      baselineWorldStateId: 'ws-a',
      variantWorldStateId: 'ws-b',
      restoredWorldStateId: 'ws-c',
      verifyEvidenceIds: ['ev-verify'],
    }));
    const challenge = writeDraft(service, 'challenge', sampleChallenge({
      targetId: (hyp.record as ClaimRecord).claimId,
    }));
    const checkpoint = writeDraft(service, 'checkpoint', sampleCheckpoint({
      established: [(hyp.record as ClaimRecord).claimId],
      completedExperiments: ['exp-1'],
      openChallenges: ['ch-1'],
      currentWorldStateId: 'ws-a',
      criticalArtifactRefs: [world.manifest.artifactId, experiment.manifest.artifactId, challenge.manifest.artifactId],
      reasonForReplan: 'Structural assumption collapsed.',
    }));
    expect(checkpoint.manifest.kind).toBe('checkpoint');
    expect(checkpoint.record).toMatchObject({
      checkpointId: 'cp-1',
      currentWorldStateId: 'ws-a',
      completedExperiments: ['exp-1'],
      openChallenges: ['ch-1'],
    });
    expect(() => writeDraft(service, 'checkpoint', sampleCheckpoint({
      checkpointId: 'cp-ghost-exp',
      completedExperiments: ['exp-missing'],
      currentWorldStateId: 'ws-a',
      criticalArtifactRefs: [world.manifest.artifactId],
    }))).toThrow(/INVESTIGATION_REF_UNRESOLVED/);
    expect(() => writeDraft(service, 'checkpoint', sampleCheckpoint({
      checkpointId: 'cp-ghost-challenge',
      openChallenges: ['ch-missing'],
      currentWorldStateId: 'ws-a',
      criticalArtifactRefs: [world.manifest.artifactId],
    }))).toThrow(/INVESTIGATION_REF_UNRESOLVED/);
    const method = readRepo('resources/agent-runtime/skills/debugger-causal-method/SKILL.md');
    expect(method).toMatch(/First Bad Event/);
    expect(method).toMatch(/Hypothesis Matrix/);
    expect(method).toMatch(/Counterfactual/);
    const execution = readRepo('resources/agent-runtime/skills/renderdoc-execution/SKILL.md');
    for (const source of [method, execution]) {
      expect(source).toMatch(/subagent/);
      expect(source).toMatch(/task_create/);
      expect(source).toMatch(/\bshell\b/);
    }
  });

  it('investigation.contract.s-rdc.positive-negative', () => {
    expect.hasAssertions();
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    writeDraft(service, 'world_state', baselineWorld('ws-base'));
    const variant = writeDraft(service, 'world_state', exclusiveWorld('ws-var'));
    writeDraft(service, 'world_state', baselineWorld('ws-restored'));
    writeDraft(service, 'claim', hypothesisClaim('ws-base'));
    writeDraft(service, 'evidence', evidenceOf('ws-restored', note, 'ev-rdc'));
    writeDraft(service, 'experiment', recordedExperiment({
      hypothesisClaimId: 'claim-hyp',
      baselineWorldStateId: 'ws-base',
      variantWorldStateId: 'ws-var',
      restoredWorldStateId: 'ws-restored',
      verifyEvidenceIds: ['ev-rdc'],
    }));
    const isolated = writeDraft(service, 'world_state', exclusiveWorld('ws-var', true), {
      supersedes: variant.manifest.artifactId,
    });
    expect(isolated.record).toMatchObject({ validity: 'valid' });
    expect(() => writeDraft(service, 'experiment', recordedExperiment({
      experimentId: 'exp-fake-ev',
      hypothesisClaimId: 'claim-hyp',
      baselineWorldStateId: 'ws-base',
      variantWorldStateId: 'ws-var',
      restoredWorldStateId: 'ws-restored',
      verifyEvidenceIds: ['ev-does-not-exist'],
    }))).toThrow(/INVESTIGATION_REF_UNRESOLVED|S-RDC-01/);
    const polluted = writeDraft(service, 'world_state', {
      ...exclusiveWorld('ws-dirty', true),
      replay: { adapter: 'vk', driver: 'adreno', device: 'device-0', exclusiveLock: false },
    });
    expect(polluted.record).toMatchObject({ validity: 'polluted' });
    const stale = writeDraft(service, 'evidence', evidenceOf('ws-dirty', note, 'ev-stale'));
    expect(stale.record).toMatchObject({ stale: true });
  });

  it('investigation.contract.non-invasion', () => {
    expect.hasAssertions();
    const task = readRepo('src/main/agent-runtime/tasks/TaskRegistry.ts');
    const profile = readRepo('src/shared/types/profile.ts');
    const message = readRepo('src/shared/types/conversation.ts');
    for (const source of [task, profile, message]) {
      expect(source).not.toMatch(/worldStateId|claimKind|compactProvenance|rdc\.investigation\.v1/);
    }
    expect(task).toMatch(/export interface TaskRecord/);
    expect(profile).toMatch(/export interface AgentProfile/);
    expect(message).toMatch(/export interface ConversationMessage/);
    expect(BUILTIN_AGENT_TOOL_IDS).not.toContain('investigation_graph');
  });

  it('investigation.contract.rail.five-cards', () => {
    expect.hasAssertions();
    const rail = readRepo('src/renderer/features/debugger/ControlPanel/TraceRightPanel.tsx');
    expect(rail).toContain('id="progress"');
    expect(rail).toContain('id="artifacts"');
    expect(rail).toContain('id="outputs"');
    expect(rail).toContain('id="context"');
    expect(rail).toContain('id="capture"');
    expect(rail).toMatch(/id="progress"[\s\S]*id="artifacts"[\s\S]*id="outputs"[\s\S]*id="context"[\s\S]*id="capture"/);
  });

  it('investigation.contract.analyzer.claimkind-layer', () => {
    expect.hasAssertions();
    const fixture = JSON.parse(readRepo('src/main/investigation/__fixtures__/analyzer-architecture-oracle.json')) as {
      oracle: {
        legal: Array<{ id: string; claimKind: ClaimRecord['claimKind']; epistemic: ClaimRecord['epistemic']; verification: ClaimRecord['verification']; layer: string }>;
        illegal: Array<{ id: string; claimKind: ClaimRecord['claimKind']; epistemic: ClaimRecord['epistemic']; verification: ClaimRecord['verification']; reason: string }>;
      };
    };
    expect(fixture.oracle.legal).toHaveLength(3);
    expect(fixture.oracle.illegal.map((entry) => entry.reason)).toEqual([
      'authoring-as-observed',
      'authoring-as-reconstructed',
      'authoring-upgraded-to-observed',
    ]);
    const { service } = createInvestigationHarness();
    writeDraft(service, 'world_state', baselineWorld(), { mission: 'analyzer' });
    for (const entry of fixture.oracle.legal) {
      const base = entry.claimKind === 'observed_fact'
        ? observedClaim('ws-baseline', entry.id)
        : entry.claimKind === 'derived_structure'
          ? derivedStructureClaim('ws-baseline', entry.id)
          : hypothesisClaim('ws-baseline', entry.id);
      const written = writeDraft(service, 'claim', {
        ...base,
        claimKind: entry.claimKind,
        epistemic: entry.epistemic,
        verification: entry.verification,
        statement: entry.layer,
      }, { mission: 'analyzer' });
      expect(written.record).toMatchObject({ claimKind: entry.claimKind, epistemic: entry.epistemic });
    }
    for (const entry of fixture.oracle.illegal) {
      expect(() => writeDraft(service, 'claim', {
        ...observedClaim('ws-baseline', entry.id),
        claimKind: entry.claimKind,
        epistemic: entry.epistemic,
        verification: entry.verification,
        statement: entry.reason,
      }, { mission: 'analyzer' })).toThrow(/ANALYZER-LAYER|claimKind|layer/);
    }
    const authoring = writeDraft(service, 'claim', hypothesisClaim('ws-baseline', 'claim-authoring-src'), {
      mission: 'analyzer',
    });
    const authoringRecord = authoring.record as ClaimRecord;
    expect(() => writeDraft(service, 'claim', {
      ...observedClaim('ws-baseline', 'claim-proj-authoring-as-observed'),
      projectionKind: 'report',
      compactProvenance: [{
        sourceClaimId: authoringRecord.claimId,
        sourceEpistemicStatus: authoringRecord.epistemic,
        sourceVerificationLevel: authoringRecord.verification,
      }],
    }, { mission: 'analyzer' })).toThrow(/ANALYZER-LAYER|claimKind|layer|S-CLAIM-01/);
    expect(() => writeDraft(service, 'claim', {
      ...hypothesisClaim('ws-baseline', 'claim-proj-skip-layer'),
      claimKind: 'semantic_inference',
      epistemic: 'observed',
      verification: 'observed',
      projectionKind: 'compact',
      compactProvenance: [{
        sourceClaimId: authoringRecord.claimId,
        sourceEpistemicStatus: authoringRecord.epistemic,
        sourceVerificationLevel: authoringRecord.verification,
      }],
    }, { mission: 'analyzer' })).toThrow(/ANALYZER-LAYER|claimKind|layer|S-CLAIM-01/);
    expect(() => service.writeRecord(SESSION_ID, {
      kind: 'report',
      mission: 'analyzer',
      title: 'Illegal authoring projection',
      summary: 'report path must carry Analyzer mission context',
      record: sampleReport({
        mission: 'analyzer',
        claims: [{
          ...observedClaim('ws-baseline', 'claim-report-authoring-as-observed'),
          projectionKind: 'report',
          compactProvenance: [{
            sourceClaimId: authoringRecord.claimId,
            sourceEpistemicStatus: authoringRecord.epistemic,
            sourceVerificationLevel: authoringRecord.verification,
          }],
        }],
        reportContract: sampleReportContract([authoring.manifest.artifactId]),
      }),
      sourceRefs: [{ artifactId: authoring.manifest.artifactId, expectedHash: authoring.contentHash }],
      status: 'ready',
    })).toThrow(/ANALYZER-LAYER|claimKind|layer|S-CLAIM-01/);
    const method = readRepo('resources/agent-runtime/skills/analyzer-architecture-method/SKILL.md');
    expect(method).toMatch(/Observed/);
    expect(method).toMatch(/Reconstructed/);
    expect(method).toMatch(/Authoring/);
    expect(method).toMatch(/Architecture Model/);
    const coordinator = readRepo('resources/agent-runtime/skills/analyzer-coordinator/SKILL.md');
    expect(coordinator).toMatch(/\$analyzer-architecture-method/);
    expect(coordinator).toMatch(/claimKind/);
  });

  it('investigation.contract.optimizer.rollback-close', () => {
    expect.hasAssertions();
    const fixture = JSON.parse(readRepo('src/main/investigation/__fixtures__/optimizer-experiment-oracle.json')) as {
      oracle: {
        closeLegal: { interventionType: string; status: 'recorded'; executed: boolean; baselineRestored: boolean; verifyEvidenceIds: string[] };
        closeIllegal: Array<{
          id: string;
          interventionType: string;
          status: 'recorded';
          executed: boolean;
          baselineRestored: boolean;
          verifyEvidenceIds: string[];
          reason: string;
        }>;
      };
    };
    expect(fixture.oracle.closeIllegal.map((entry) => entry.reason)).toEqual([
      'mutate-without-rollback',
      'none-is-not-counterfactual',
    ]);
    const { resolver, service } = createInvestigationHarness();
    const note = seedNote(resolver);
    writeDraft(service, 'world_state', baselineWorld('ws-base'), { mission: 'optimizer' });
    writeDraft(service, 'world_state', exclusiveWorld('ws-var'), { mission: 'optimizer' });
    writeDraft(service, 'world_state', baselineWorld('ws-restored'), { mission: 'optimizer' });
    writeDraft(service, 'claim', hypothesisClaim('ws-base', 'claim-opt'), { mission: 'optimizer' });
    writeDraft(service, 'evidence', { ...evidenceOf('ws-restored', note, 'ev-verify'), mission: 'optimizer' }, { mission: 'optimizer' });
    const legal = writeDraft(service, 'experiment', recordedExperiment({
      experimentId: 'exp-opt-legal',
      hypothesisClaimId: 'claim-opt',
      baselineWorldStateId: 'ws-base',
      variantWorldStateId: 'ws-var',
      restoredWorldStateId: 'ws-restored',
      verifyEvidenceIds: fixture.oracle.closeLegal.verifyEvidenceIds,
      interventionType: fixture.oracle.closeLegal.interventionType,
      status: fixture.oracle.closeLegal.status,
      executed: fixture.oracle.closeLegal.executed,
      baselineRestored: fixture.oracle.closeLegal.baselineRestored,
    }), { mission: 'optimizer' });
    expect(legal.record).toMatchObject({ status: 'recorded', experimentId: 'exp-opt-legal' });
    for (const entry of fixture.oracle.closeIllegal) {
      expect(() => writeDraft(service, 'experiment', recordedExperiment({
        experimentId: entry.id,
        hypothesisClaimId: 'claim-opt',
        baselineWorldStateId: 'ws-base',
        variantWorldStateId: 'ws-var',
        restoredWorldStateId: 'ws-restored',
        verifyEvidenceIds: entry.verifyEvidenceIds,
        interventionType: entry.interventionType,
        status: entry.status,
        executed: entry.executed,
        baselineRestored: entry.baselineRestored,
      }), { mission: 'optimizer' })).toThrow(/S-RDC-01|S-CAUSAL-01|rollback|none/);
    }
    expect(() => writeDraft(service, 'experiment', recordedExperiment({
      experimentId: 'exp-disguised-debugger',
      hypothesisClaimId: 'claim-opt',
      baselineWorldStateId: 'ws-base',
      variantWorldStateId: 'ws-var',
      restoredWorldStateId: 'ws-restored',
      verifyEvidenceIds: [],
      executed: false,
      baselineRestored: false,
      actionClass: 'C',
    }), { mission: 'debugger' })).toThrow(/S-RDC-01|S-CAUSAL-01|rollback|none/);
    expect(() => writeDraft(service, 'experiment', recordedExperiment({
      experimentId: 'exp-debugger-no-rollback',
      hypothesisClaimId: 'claim-opt',
      baselineWorldStateId: 'ws-base',
      variantWorldStateId: 'ws-var',
      restoredWorldStateId: 'ws-restored',
      verifyEvidenceIds: [],
      executed: false,
      baselineRestored: false,
    }), { mission: 'debugger' })).toThrow(/S-RDC-01|S-CAUSAL-01|rollback|none/);
    const legalSource = service.createLookup(SESSION_ID).getClaim('claim-opt');
    expect(legalSource).toBeTruthy();
    if (!legalSource) throw new Error('expected optimizer hypothesis');
    const projectedOpt: ClaimRecord = {
      ...legalSource,
      claimId: 'claim-opt-report',
      projectionKind: 'report',
      compactProvenance: [{
        sourceClaimId: legalSource.claimId,
        sourceEpistemicStatus: legalSource.epistemic,
        sourceVerificationLevel: legalSource.verification,
      }],
    };
    expect(() => service.writeRecord(SESSION_ID, {
      kind: 'report',
      mission: 'optimizer',
      title: 'Empty claims fake artifacts',
      summary: 'must not become ready',
      record: sampleReport({
        mission: 'optimizer',
        claims: [],
        reportContract: sampleReportContract(['artifact-does-not-exist']),
      }),
      sourceRefs: [{ artifactId: legal.manifest.artifactId, expectedHash: legal.contentHash }],
      status: 'ready',
    })).toThrow(/S-CLAIM-01|INVESTIGATION_REF_UNRESOLVED|artifact|claims/);
    plantInvestigationRecord(resolver, {
      artifactId: 'art-exp-disguised-plant',
      kind: 'experiment',
      recordType: 'ExperimentRecord',
      recordKey: 'exp-planted-no-rollback',
      record: recordedExperiment({
        experimentId: 'exp-planted-no-rollback',
        hypothesisClaimId: 'claim-opt',
        baselineWorldStateId: 'ws-base',
        variantWorldStateId: 'ws-var',
        restoredWorldStateId: 'ws-restored',
        verifyEvidenceIds: [],
        executed: false,
        baselineRestored: false,
      }),
    });
    expect(() => service.writeRecord(SESSION_ID, {
      kind: 'report',
      mission: 'optimizer',
      title: 'Cite disguised experiment',
      summary: 'masqueraded debugger experiment is not qualifying',
      record: sampleReport({
        mission: 'optimizer',
        claims: [projectedOpt],
        experimentIds: ['exp-planted-no-rollback'],
        reportContract: sampleReportContract([legal.manifest.artifactId]),
      }),
      sourceRefs: [{ artifactId: legal.manifest.artifactId, expectedHash: legal.contentHash }],
      status: 'ready',
    })).toThrow(/S-RDC-01|S-CAUSAL-01|rollback|INVESTIGATION_REF_UNRESOLVED|INVESTIGATION_INVARIANT/);
    const coordinator = readRepo('resources/agent-runtime/skills/optimizer-coordinator/SKILL.md');
    expect(coordinator).toMatch(/\$optimization-experiment/);
    expect(coordinator).toMatch(/A-B-A/);
    const experimentSkill = readRepo('resources/agent-runtime/skills/optimization-experiment/SKILL.md');
    expect(experimentSkill).toMatch(/rollback/);
    expect(experimentSkill).toMatch(/intervention\.type != none|intervention\.type == none/);
    const report = readRepo('resources/agent-runtime/skills/report-composition/SKILL.md');
    expect(report).toMatch(/reportContract/);
    expect(report).toMatch(/candidateStatus/);
  });
});
