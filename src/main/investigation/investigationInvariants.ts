import {
  epistemicRank,
  isCausalOrCounterfactualClaim,
  isWorldStateMutated,
  type ChallengeRecord,
  type ClaimRecord,
  type CompactProvenanceEntry,
  type EvidenceRecord,
  type ExperimentRecord,
  type InvestigationReport,
  type WorldState,
} from '@shared/types/renderdocInvestigation';
import { InvestigationError } from './investigationErrors';

export type InvestigationLookup = {
  getWorldState(worldStateId: string): WorldState | null;
  getClaim(claimId: string): ClaimRecord | null;
  getEvidence(evidenceId: string): EvidenceRecord | null;
  getExperiment(experimentId: string): ExperimentRecord | null;
  getChallenge?(challengeId: string): { challengeId: string } | null;
  getArtifact?(artifactId: string): { artifactId: string } | null;
};

export function assertSClaim01(
  claim: ClaimRecord,
  lookup: InvestigationLookup,
  options?: { treatAsProjected?: boolean },
): void {
  const projected = options?.treatAsProjected === true || claim.projectionKind != null;
  const provenance = claim.compactProvenance;
  if (projected && (!provenance || provenance.length === 0)) {
    throw new InvestigationError(
      'INVESTIGATION_INVARIANT_VIOLATION',
      'projected Claim requires non-empty compactProvenance',
      { invariantId: 'S-CLAIM-01' },
    );
  }
  if (!provenance || provenance.length === 0) return;
  let minRank = Number.POSITIVE_INFINITY;
  for (const entry of provenance) {
    const source = lookup.getClaim(entry.sourceClaimId);
    if (!source) {
      throw new InvestigationError(
        'INVESTIGATION_INVARIANT_VIOLATION',
        `compactProvenance source ${entry.sourceClaimId} is not resolvable`,
        { invariantId: 'S-CLAIM-01', details: { sourceClaimId: entry.sourceClaimId } },
      );
    }
    assertProvenanceMatchesSource(entry, source);
    minRank = Math.min(minRank, epistemicRank(entry.sourceEpistemicStatus));
  }
  if (epistemicRank(claim.epistemic) > minRank) {
    throw new InvestigationError(
      'INVESTIGATION_INVARIANT_VIOLATION',
      'projected Claim must not raise epistemic rank above min(source ranks)',
      { invariantId: 'S-CLAIM-01', details: { projected: claim.epistemic, maxLegalRank: minRank } },
    );
  }
}

export function assertProvenanceMatchesSource(entry: CompactProvenanceEntry, source: ClaimRecord): void {
  if (
    entry.sourceClaimId !== source.claimId
    || entry.sourceEpistemicStatus !== source.epistemic
    || entry.sourceVerificationLevel !== source.verification
  ) {
    throw new InvestigationError(
      'INVESTIGATION_INVARIANT_VIOLATION',
      'compactProvenance fields must match the source ClaimRecord verbatim',
      { invariantId: 'S-CLAIM-01', details: { sourceClaimId: source.claimId } },
    );
  }
}

export function assertSCausal01(claim: ClaimRecord, lookup: InvestigationLookup): void {
  if (!isCausalOrCounterfactualClaim(claim)) return;
  if (!claim.experimentId) {
    throw new InvestigationError(
      'INVESTIGATION_INVARIANT_VIOLATION',
      'causal/counterfactual Claim requires experimentId',
      { invariantId: 'S-CAUSAL-01' },
    );
  }
  const experiment = lookup.getExperiment(claim.experimentId);
  if (!experiment) {
    throw new InvestigationError(
      'INVESTIGATION_INVARIANT_VIOLATION',
      `experiment ${claim.experimentId} is not resolvable`,
      { invariantId: 'S-CAUSAL-01', details: { experimentId: claim.experimentId } },
    );
  }
  if (experiment.intervention.type === 'none') {
    throw new InvestigationError(
      'INVESTIGATION_INVARIANT_VIOLATION',
      'intervention.type == none cannot support a counterfactual Claim',
      { invariantId: 'S-CAUSAL-01' },
    );
  }
  if (experiment.status !== 'recorded' && experiment.status !== 'rolled_back') {
    throw new InvestigationError(
      'INVESTIGATION_INVARIANT_VIOLATION',
      'causal experiment status must be recorded or rolled_back',
      { invariantId: 'S-CAUSAL-01', details: { status: experiment.status } },
    );
  }
  const rollback = experiment.rollback;
  if (rollback.executed !== true || rollback.baselineRestored !== true || rollback.verifyEvidenceIds.length < 1) {
    throw new InvestigationError(
      'INVESTIGATION_INVARIANT_VIOLATION',
      'rollback.executed, baselineRestored, and verifyEvidenceIds are all required',
      { invariantId: 'S-CAUSAL-01' },
    );
  }
  for (const evidenceId of rollback.verifyEvidenceIds) {
    if (!lookup.getEvidence(evidenceId)) {
      throw new InvestigationError(
        'INVESTIGATION_INVARIANT_VIOLATION',
        `verify evidence ${evidenceId} is not resolvable`,
        { invariantId: 'S-CAUSAL-01', details: { evidenceId } },
      );
    }
  }
}

export function worldStateMarksEvidenceStale(
  worldState: WorldState,
  verdict: { staleEvidence: boolean },
): boolean {
  return verdict.staleEvidence || worldState.validity === 'polluted' || worldState.validity === 'stale';
}

export function assertClaimRecordRefs(
  claim: ClaimRecord,
  lookup: InvestigationLookup,
  options?: { treatAsProjected?: boolean },
): void {
  if (!lookup.getWorldState(claim.worldStateId)) {
    throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `worldState ${claim.worldStateId}`);
  }
  for (const otherId of [...(claim.supports ?? []), ...(claim.contradicts ?? [])]) {
    if (otherId === claim.claimId || !lookup.getClaim(otherId)) {
      throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `claim ref ${otherId}`);
    }
  }
  if (claim.experimentId && !lookup.getExperiment(claim.experimentId)) {
    throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `experiment ${claim.experimentId}`);
  }
  assertSClaim01(claim, lookup, options);
  if (isCausalOrCounterfactualClaim(claim)) assertSCausal01(claim, lookup);
}

export function assertReportRecordRefs(report: InvestigationReport, lookup: InvestigationLookup): void {
  for (const evidenceId of report.evidenceIds) {
    if (!lookup.getEvidence(evidenceId)) {
      throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `report evidence ${evidenceId}`);
    }
  }
  for (const experimentId of report.experimentIds) {
    if (!lookup.getExperiment(experimentId)) {
      throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `report experiment ${experimentId}`);
    }
  }
  for (const claim of report.claims) {
    assertClaimRecordRefs(claim, lookup, { treatAsProjected: true });
  }
}

export function assertChallengeRecordRefs(challenge: ChallengeRecord, lookup: InvestigationLookup): void {
  const { type, id } = challenge.targetRef;
  const resolved = type === 'claim'
    ? lookup.getClaim(id)
    : type === 'evidence'
      ? lookup.getEvidence(id)
      : lookup.getExperiment(id);
  if (!resolved) {
    throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `challenge target ${type}:${id}`);
  }
  if (challenge.status === 'resolved' && challenge.resolutionClaimId && !lookup.getClaim(challenge.resolutionClaimId)) {
    throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `resolution claim ${challenge.resolutionClaimId}`);
  }
}

export function assertCheckpointRecordRefs(
  checkpoint: {
    currentWorldStateId: string;
    completedExperiments: string[];
    openChallenges: string[];
    criticalArtifactRefs: string[];
    established: string[];
    rejected: string[];
  },
  lookup: InvestigationLookup,
): void {
  if (!lookup.getWorldState(checkpoint.currentWorldStateId)) {
    throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `worldState ${checkpoint.currentWorldStateId}`);
  }
  for (const experimentId of checkpoint.completedExperiments) {
    if (!lookup.getExperiment(experimentId)) {
      throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `experiment ${experimentId}`);
    }
  }
  for (const challengeId of checkpoint.openChallenges) {
    if (!lookup.getChallenge?.(challengeId)) {
      throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `challenge ${challengeId}`);
    }
  }
  for (const artifactId of checkpoint.criticalArtifactRefs) {
    if (!lookup.getArtifact?.(artifactId)) {
      throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `artifact ${artifactId}`);
    }
  }
  for (const claimId of [...checkpoint.established, ...checkpoint.rejected]) {
    if (!lookup.getClaim(claimId)) {
      throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `claim ${claimId}`);
    }
  }
}

export function assertSState01(evidence: EvidenceRecord, lookup: InvestigationLookup): void {
  if (!lookup.getWorldState(evidence.worldStateId)) {
    throw new InvestigationError(
      'INVESTIGATION_REF_UNRESOLVED',
      `Evidence.worldStateId ${evidence.worldStateId} is not resolvable`,
      { invariantId: 'S-STATE-01', details: { worldStateId: evidence.worldStateId } },
    );
  }
}

export function verifyEvidenceIdsResolvable(
  evidenceIds: string[],
  lookup: InvestigationLookup,
): boolean {
  return evidenceIds.length >= 1 && evidenceIds.every((evidenceId) => Boolean(lookup.getEvidence(evidenceId)));
}

export function experimentSatisfiesRdcIsolation(
  experiment: ExperimentRecord | null,
  lookup: InvestigationLookup,
): boolean {
  if (!experiment) return false;
  if (experiment.intervention.type === 'none') return false;
  const rollback = experiment.rollback;
  return rollback.executed === true
    && rollback.baselineRestored === true
    && verifyEvidenceIdsResolvable(rollback.verifyEvidenceIds, lookup);
}

export function evaluateSRdc01(input: {
  worldState: WorldState;
  experiment: ExperimentRecord | null;
  lookup: InvestigationLookup;
}): { polluted: boolean; staleEvidence: boolean } {
  if (!isWorldStateMutated(input.worldState)) {
    return { polluted: false, staleEvidence: false };
  }
  const isolated = input.worldState.replay.exclusiveLock === true
    && experimentSatisfiesRdcIsolation(input.experiment, input.lookup);
  if (isolated) return { polluted: false, staleEvidence: false };
  return { polluted: true, staleEvidence: true };
}

export function collectProjectedClaims(record: unknown): ClaimRecord[] {
  if (!record || typeof record !== 'object') return [];
  const value = record as Record<string, unknown>;
  if (Array.isArray(value.items)) {
    return value.items.filter((item): item is ClaimRecord => isClaimRecord(item));
  }
  if (Array.isArray(value.claims)) {
    return value.claims.filter((item): item is ClaimRecord => isClaimRecord(item));
  }
  return isClaimRecord(record) ? [record] : [];
}

function isClaimRecord(value: unknown): value is ClaimRecord {
  return Boolean(value && typeof value === 'object' && 'claimId' in value && 'claimKind' in value && 'epistemic' in value);
}
