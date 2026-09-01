import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  INVESTIGATION_SCHEMA_NAMESPACE,
  type ArtifactSourceRef,
  type ChallengeRecord,
  type ClaimRecord,
  type EvidenceRecord,
  type ExperimentRecord,
  type InvestigationArtifactKind,
  type InvestigationMission,
  type InvestigationReport,
  type InvestigationReportContract,
  type MissionCheckpoint,
  type WorldState,
} from '@shared/types/renderdocInvestigation';
import { formatSessionArtifactUri } from '@shared/types/sessionArtifact';
import { SessionArtifactResolver } from '../sessions/SessionArtifactResolver';
import { formatInvestigationContentHash } from '@shared/types/renderdocInvestigation';
import { serializeInvestigationJson } from './investigationHash';
import { InvestigationArtifactService } from './InvestigationArtifactService';

export const SESSION_ID = 'inv-session';

export function createInvestigationHarness(prefix = 'rdc-inv-') {
  const sessionPath = mkdtempSync(path.join(tmpdir(), prefix));
  const resolver = new SessionArtifactResolver({
    resolveSessionPath: (id) => (id === SESSION_ID ? sessionPath : null),
  });
  const service = new InvestigationArtifactService({
    resolver,
    now: () => new Date('2026-09-01T00:00:00.000Z'),
  });
  return { sessionPath, resolver, service };
}

export function seedNote(resolver: SessionArtifactResolver, text = '{"note":true}') {
  const uri = formatSessionArtifactUri('investigation', 'seeds/note.json');
  const written = resolver.write(SESSION_ID, uri, `${text}\n`, { mimeType: 'application/json' });
  return { uri, hash: formatInvestigationContentHash(written.hash), bareHash: written.hash };
}

export function baselineWorld(id = 'ws-baseline'): WorldState {
  return {
    worldStateId: id,
    kind: 'baseline',
    captureRef: 'captures/sample.rdc',
    replay: { adapter: 'vk', driver: 'adreno', device: 'device-0', exclusiveLock: false },
    shaderReplacement: null,
    patchStack: [],
    focus: { event: 'E1' },
    benchmark: { warmup: 3, resolution: '1920x1080', vsync: false, samplingProtocol: 'median-of-3' },
    validity: 'valid',
  };
}

export function exclusiveWorld(id: string, mutated = false): WorldState {
  return {
    ...baselineWorld(id),
    kind: 'experiment',
    replay: { adapter: 'vk', driver: 'adreno', device: 'device-0', exclusiveLock: true },
    shaderReplacement: mutated ? { shaderId: 'ps-0', replacementRef: 'shaders/ps-patched.spv' } : null,
    patchStack: mutated ? [{ patchId: 'p1', summary: 'replace PS' }] : [],
  };
}

export function hypothesisClaim(worldStateId: string, claimId = 'claim-hyp'): ClaimRecord {
  return {
    claimId,
    claimKind: 'hypothesis',
    statement: 'The pixel error is caused by the patched shader.',
    epistemic: 'inferred',
    confidence: 'probable',
    verification: 'reconstructed',
    worldStateId,
    experimentId: null,
    declaresCounterfactual: false,
    scope: { capture: 'sample', eventId: 'E1' },
    projectionKind: null,
    compactProvenance: null,
  };
}

export function derivedStructureClaim(worldStateId: string, claimId = 'claim-derived'): ClaimRecord {
  return {
    ...hypothesisClaim(worldStateId, claimId),
    claimKind: 'derived_structure',
    statement: 'Pass P0 consumes RT0 written by event E2.',
    epistemic: 'derived',
    confidence: 'strong',
    verification: 'reconstructed',
  };
}

export function observedClaim(worldStateId: string, claimId = 'claim-obs'): ClaimRecord {
  return {
    ...hypothesisClaim(worldStateId, claimId),
    claimKind: 'observed_fact',
    statement: 'The present color is magenta.',
    epistemic: 'observed',
    confidence: 'exact',
    verification: 'observed',
  };
}

export function evidenceOf(
  worldStateId: string,
  artifact: { uri: string; hash: string },
  evidenceId = 'ev-1',
): EvidenceRecord {
  return {
    evidenceId,
    mission: 'debugger',
    observationKind: 'image_compare',
    summary: 'Before/after color mismatch',
    epistemicStatus: 'observed',
    worldStateId,
    source: { kind: 'tool', name: 'image_compare', parameterFingerprint: 'fp-1' },
    artifactRefs: [{ uri: artifact.uri, expectedHash: artifact.hash }],
    contentHashes: [artifact.hash],
    claimIds: [],
    strength: 'strong',
    stale: false,
  };
}

export function recordedExperiment(input: {
  experimentId?: string;
  hypothesisClaimId: string;
  baselineWorldStateId: string;
  variantWorldStateId: string;
  restoredWorldStateId: string;
  verifyEvidenceIds: string[];
  interventionType?: string;
  status?: ExperimentRecord['status'];
  executed?: boolean;
  baselineRestored?: boolean;
  actionClass?: ExperimentRecord['actionClass'];
  visualValidation?: ExperimentRecord['visualValidation'];
  protocolKind?: ExperimentRecord['protocol']['kind'];
}): ExperimentRecord {
  return {
    experimentId: input.experimentId ?? 'exp-1',
    hypothesisClaimId: input.hypothesisClaimId,
    intervention: { type: input.interventionType ?? 'shader_replace', payload: { shaderId: 'ps-0' } },
    baselineWorldStateId: input.baselineWorldStateId,
    variantWorldStateId: input.variantWorldStateId,
    restoredWorldStateId: input.restoredWorldStateId,
    controlledVariables: ['resolution', 'vsync'],
    changedVariables: ['pixel-shader'],
    metrics: [{ name: 'present-delta', kind: 'visual' }],
    protocol: { kind: input.protocolKind ?? 'A-B-A', warmup: 3, noiseThreshold: 0.02 },
    result: { summary: 'delta confirmed', accepted: true },
    rollback: {
      executed: input.executed ?? true,
      baselineRestored: input.baselineRestored ?? true,
      verifyEvidenceIds: input.verifyEvidenceIds,
    },
    status: input.status ?? 'recorded',
    ...(input.visualValidation ? { visualValidation: input.visualValidation } : {}),
    ...(input.actionClass ? { actionClass: input.actionClass } : {}),
  };
}

export function sampleChallenge(input: {
  challengeId?: string;
  targetType?: ChallengeRecord['targetRef']['type'];
  targetId: string;
  challengeKind?: ChallengeRecord['challengeKind'];
  requiredFollowUp?: string;
  status?: ChallengeRecord['status'];
  resolutionClaimId?: string;
}): ChallengeRecord {
  return {
    challengeId: input.challengeId ?? 'ch-1',
    targetRef: { type: input.targetType ?? 'claim', id: input.targetId },
    challengeKind: input.challengeKind ?? 'missing_evidence',
    statement: 'The claim needs a distinguishing follow-up.',
    requiredFollowUp: input.requiredFollowUp ?? 'Collect the first diverging event color.',
    status: input.status ?? 'open',
    resolutionClaimId: input.resolutionClaimId,
  };
}

export function sampleCheckpoint(input: {
  checkpointId?: string;
  established?: string[];
  rejected?: string[];
  completedExperiments?: string[];
  openChallenges?: string[];
  currentWorldStateId: string;
  criticalArtifactRefs?: string[];
  reasonForReplan?: string;
}): MissionCheckpoint {
  return {
    checkpointId: input.checkpointId ?? 'cp-1',
    goal: 'Locate the first bad event and a qualifying counterfactual.',
    planVersion: 'plan-v2',
    established: input.established ?? [],
    rejected: input.rejected ?? [],
    completedExperiments: input.completedExperiments ?? [],
    openChallenges: input.openChallenges ?? [],
    reasonForReplan: input.reasonForReplan,
    currentWorldStateId: input.currentWorldStateId,
    criticalArtifactRefs: input.criticalArtifactRefs ?? [],
    unresolvedFrontier: 'Need a distinguishing experiment.',
  };
}

export function sampleReportContract(artifactIds: string[]): InvestigationReportContract {
  return {
    conclusion: 'Projected conclusion with explicit limitations.',
    evidence: 'Linked evidence artifacts are dereferenceable.',
    verification: 'Compact provenance is closed and not upgraded.',
    limitations: 'Fixture report; no runtime counterfactual beyond cited experiments.',
    artifactIds,
    candidateStatus: 'none',
  };
}

export function sampleReport(input: {
  claims: ClaimRecord[];
  evidenceIds?: string[];
  experimentIds?: string[];
  mission?: InvestigationMission;
  reportContract?: InvestigationReportContract;
}): InvestigationReport {
  return {
    title: 'Investigation report',
    mission: input.mission ?? 'debugger',
    summary: 'Projected report',
    claims: input.claims,
    evidenceIds: input.evidenceIds ?? [],
    experimentIds: input.experimentIds ?? [],
    reportContract: input.reportContract,
  };
}

export function writeDraft(
  service: InvestigationArtifactService,
  kind: string,
  record: unknown,
  extras: Partial<{
    title: string;
    summary: string;
    worldStateId: string;
    artifactId: string;
    supersedes: string;
    sourceRefs: ArtifactSourceRef[];
    status: 'draft' | 'ready';
    mission: 'debugger' | 'analyzer' | 'optimizer';
  }> = {},
) {
  return service.writeRecord(SESSION_ID, {
    kind,
    mission: extras.mission ?? 'debugger',
    title: extras.title ?? kind,
    summary: extras.summary ?? kind,
    record,
    worldStateId: extras.worldStateId,
    artifactId: extras.artifactId,
    supersedes: extras.supersedes,
    sourceRefs: extras.sourceRefs,
    status: extras.status ?? 'draft',
  });
}

export function plantInvestigationRecord(
  resolver: SessionArtifactResolver,
  input: {
    artifactId: string;
    kind: InvestigationArtifactKind;
    recordType: string;
    recordKey: string;
    record: unknown;
  },
): void {
  const contentUri = formatSessionArtifactUri('investigation', `records/${input.artifactId}.json`);
  const manifestUri = formatSessionArtifactUri('investigation', `manifests/${input.artifactId}.json`);
  const indexUri = formatSessionArtifactUri('investigation', 'index.json');
  const written = resolver.write(SESSION_ID, contentUri, serializeInvestigationJson(input.record), {
    mimeType: 'application/json',
  });
  const contentHash = formatInvestigationContentHash(written.hash);
  resolver.write(SESSION_ID, manifestUri, serializeInvestigationJson({
    artifactId: input.artifactId,
    mission: 'debugger',
    kind: input.kind,
    status: 'draft',
    title: input.kind,
    summary: input.kind,
    contentRef: contentUri,
    sourceRefs: [],
    contentHash,
    recordType: input.recordType,
    createdAt: '2026-09-01T00:00:00.000Z',
  }), { mimeType: 'application/json' });
  let artifacts: Array<Record<string, unknown>> = [];
  try {
    const existing = resolver.read(SESSION_ID, indexUri);
    const parsed = JSON.parse(existing.text ?? '{}') as { artifacts?: Array<Record<string, unknown>> };
    if (Array.isArray(parsed.artifacts)) artifacts = parsed.artifacts;
  } catch {
    artifacts = [];
  }
  artifacts.push({
    artifactId: input.artifactId,
    kind: input.kind,
    recordType: input.recordType,
    status: 'draft',
    contentUri,
    manifestUri,
    contentHash,
    createdAt: '2026-09-01T00:00:00.000Z',
    recordKey: input.recordKey,
  });
  resolver.write(SESSION_ID, indexUri, serializeInvestigationJson({
    schemaVersion: INVESTIGATION_SCHEMA_NAMESPACE,
    artifacts,
  }), { mimeType: 'application/json' });
}

export function overwriteInvestigationRecordBody(
  resolver: SessionArtifactResolver,
  artifactId: string,
  record: unknown,
): void {
  const contentUri = formatSessionArtifactUri('investigation', `records/${artifactId}.json`);
  resolver.write(SESSION_ID, contentUri, serializeInvestigationJson(record), { mimeType: 'application/json' });
}

export function overwriteInvestigationManifest(
  resolver: SessionArtifactResolver,
  artifactId: string,
  patch: Record<string, unknown>,
): void {
  const manifestUri = formatSessionArtifactUri('investigation', `manifests/${artifactId}.json`);
  const manifest = JSON.parse(resolver.read(SESSION_ID, manifestUri).text ?? '{}') as Record<string, unknown>;
  resolver.write(SESSION_ID, manifestUri, serializeInvestigationJson({
    ...manifest,
    ...patch,
  }), { mimeType: 'application/json' });
}

export function forceReadyEmptySourceRefs(
  resolver: SessionArtifactResolver,
  artifactId: string,
): void {
  const manifestUri = formatSessionArtifactUri('investigation', `manifests/${artifactId}.json`);
  const indexUri = formatSessionArtifactUri('investigation', 'index.json');
  const manifest = JSON.parse(resolver.read(SESSION_ID, manifestUri).text ?? '{}') as Record<string, unknown>;
  resolver.write(SESSION_ID, manifestUri, serializeInvestigationJson({
    ...manifest,
    status: 'ready',
    sourceRefs: [],
  }), { mimeType: 'application/json' });
  const index = JSON.parse(resolver.read(SESSION_ID, indexUri).text ?? '{}') as {
    schemaVersion: string;
    artifacts: Array<Record<string, unknown>>;
  };
  resolver.write(SESSION_ID, indexUri, serializeInvestigationJson({
    ...index,
    artifacts: index.artifacts.map((entry) => (
      entry.artifactId === artifactId ? { ...entry, status: 'ready' } : entry
    )),
  }), { mimeType: 'application/json' });
}
