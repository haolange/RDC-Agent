import { type ArtifactSourceRef, type ChallengeRecord, type ClaimRecord, type ClaimSet, type EvidencePack, type EvidenceRecord, type ExperimentRecord, type InvestigationArtifactKind, type InvestigationMission, type InvestigationRecord, type InvestigationReport, type WorldState } from '@shared/types/renderdocInvestigation';
import { SessionArtifactError } from '../sessions/artifacts/sessionArtifactContract';
import { isCausalOrCounterfactualClaim } from './investigationInvariants';
import { InvestigationError } from './investigationErrors';
import { hashesEqual } from './investigationHash';
import { assertChallengeRecordRefs, assertCheckpointRecordRefs, assertClaimRecordRefs, assertEvidenceLinks, assertObservedToolEvidenceHasArtifact, assertOptimizerExperimentClose, assertReportRecordRefs, assertSCausal01, assertSClaim01, assertSState01, collectProjectedClaims, evaluateSRdc01, worldStateMarksEvidenceStale, type InvestigationLookup } from './investigationInvariants';
import { inferWorldStateId, isWorldStateBoundKind } from './investigationRecordKeys';
import { worldStateBindError, worldStateResolvable } from './investigationArtifactWrite';
import type { InvestigationMutationReader } from './investigationArtifactMutations';
import type { InvestigationIndexDocument, InvestigationIndexEntry } from './investigationRecordKeys';
import type { RdcExecutionReceipts } from '../rdc/RdcExecutionReceipts';
import type { SessionArtifactResolver } from '../sessions/artifacts/SessionArtifactResolver';

/** What record checks read from the owning service: the resolver, receipts and the verified index. */
export interface InvestigationRecordCheckHost {
  resolver: SessionArtifactResolver;
  receiptStore: RdcExecutionReceipts;
  findIndexEntry: (sessionId: string, artifactId: string) => InvestigationIndexEntry | undefined;
  readIndex: (sessionId: string) => InvestigationIndexDocument;
  recordReader: (sessionId: string) => InvestigationMutationReader;
}

/**
 * InvestigationRecordChecks — semantic invariants of one Investigation record against the session's
 * records: evidence sources and content refs, signed execution evidence, RDC isolation and stale
 * evidence, and the WorldState a record binds to.
 */
export class InvestigationRecordChecks {
  constructor(private readonly host: InvestigationRecordCheckHost) {}

  assertRecordInvariants(
    sessionId: string,
    kind: InvestigationArtifactKind,
    record: InvestigationRecord,
    lookup: InvestigationLookup,
    mission?: InvestigationMission,
  ): void {
    const claimSetItems = kind === 'claim_set' ? (record as ClaimSet).items : [];
    const recordLookup: InvestigationLookup = claimSetItems.length > 0
      ? { ...lookup, getClaim: (claimId) => claimSetItems.find((item) => item.claimId === claimId) ?? lookup.getClaim(claimId) }
      : lookup;
    if (kind === 'world_state' && mission === 'optimizer' && 'status' in (record as WorldState).benchmark) {
      throw new InvestigationError('INVESTIGATION_SCHEMA_INVALID', 'Optimizer WorldState requires measured benchmark settings');
    }
    if (kind === 'evidence') {
      this.assertEvidenceInvariants(sessionId, record as EvidenceRecord, lookup);
    }
    if (kind === 'evidence_pack') {
      for (const evidence of (record as EvidencePack).items) {
        this.assertEvidenceInvariants(sessionId, evidence, lookup);
      }
    }
    if (kind === 'claim') {
      assertClaimRecordRefs(record as ClaimRecord, lookup, { mission });
    }
    if (kind === 'claim_set') {
      for (const claim of (record as ClaimSet).items) {
        assertClaimRecordRefs(claim, recordLookup, { mission });
      }
    }
    if (kind === 'experiment') {
      const experiment = record as ExperimentRecord;
      if (!lookup.getClaim(experiment.hypothesisClaimId)) {
        throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `hypothesis ${experiment.hypothesisClaimId}`);
      }
      for (const worldStateId of [
        experiment.baselineWorldStateId,
        experiment.variantWorldStateId,
        experiment.restoredWorldStateId,
      ]) {
        if (!lookup.getWorldState(worldStateId)) {
          throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `worldState ${worldStateId}`);
        }
      }
      for (const evidenceId of experiment.rollback.verifyEvidenceIds) {
        if (!lookup.getEvidence(evidenceId)) {
          throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `verify evidence ${evidenceId}`, {
            invariantId: 'S-RDC-01',
          });
        }
      }
      assertOptimizerExperimentClose(experiment, mission);
    }
    if (kind === 'challenge') {
      assertChallengeRecordRefs(record as ChallengeRecord, lookup);
    }
    if (kind === 'checkpoint') {
      assertCheckpointRecordRefs(record as {
        currentWorldStateId: string;
        completedExperiments: string[];
        openChallenges: string[];
        criticalArtifactRefs: string[];
        established: string[];
        rejected: string[];
      }, lookup);
    }
    if (kind === 'report') {
      assertReportRecordRefs(record as InvestigationReport, lookup, { mission });
    }
    if (kind !== 'report') {
      for (const claim of collectProjectedClaims(record)) {
        assertSClaim01(claim, recordLookup);
        if (isCausalOrCounterfactualClaim(claim)) assertSCausal01(claim, recordLookup);
      }
    }
  }

  applyRdcIsolation(
    sessionId: string,
    kind: InvestigationArtifactKind,
    record: InvestigationRecord,
    lookup: InvestigationLookup,
  ): { record: InvestigationRecord; markEvidenceStaleFor?: string } {
    if (kind === 'world_state') {
      const worldState = { ...(record as WorldState) };
      const experiment = this.findExperimentForWorldState(sessionId, worldState.worldStateId);
      const verdict = evaluateSRdc01({ worldState, experiment, lookup });
      if (verdict.polluted) {
        worldState.validity = 'polluted';
      }
      return {
        record: worldState,
        markEvidenceStaleFor: worldStateMarksEvidenceStale(worldState, verdict)
          ? worldState.worldStateId
          : undefined,
      };
    }
    if (kind === 'evidence') {
      return { record: this.applyEvidenceStale(sessionId, record as EvidenceRecord, lookup) };
    }
    if (kind === 'evidence_pack') {
      const pack = record as EvidencePack;
      return {
        record: {
          items: pack.items.map((evidence) => this.applyEvidenceStale(sessionId, evidence, lookup)),
        },
      };
    }
    return { record };
  }

  assertSourceRef(sessionId: string, source: ArtifactSourceRef): void {
    const entry = this.host.findIndexEntry(sessionId, source.artifactId);
    if (!entry) {
      throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `source artifact ${source.artifactId}`, {
        invariantId: 'S-CTX-01',
      });
    }
    try {
      const read = this.host.resolver.read(sessionId, entry.contentUri, {
        expectedHash: source.expectedHash.replace(/^sha256:/i, ''),
      });
      if (!hashesEqual(source.expectedHash, read.hash) || !hashesEqual(source.expectedHash, entry.contentHash)) {
        throw new InvestigationError('INVESTIGATION_HASH_MISMATCH', `source ${source.artifactId} hash mismatch`, {
          invariantId: 'S-CTX-01',
        });
      }
    } catch (error) {
      if (error instanceof InvestigationError) throw error;
      const message = error instanceof SessionArtifactError || error instanceof Error ? error.message : String(error);
      throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', message, { invariantId: 'S-CTX-01' });
    }
  }

  assertContentRef(sessionId: string, uri: string, expectedHash: string): void {
    try {
      this.host.resolver.read(sessionId, uri, { expectedHash: expectedHash.replace(/^sha256:/i, '') });
    } catch (error) {
      if (error instanceof InvestigationError) throw error;
      if (error instanceof SessionArtifactError && error.code === 'ARTIFACT_HASH_MISMATCH') {
        throw new InvestigationError('INVESTIGATION_HASH_MISMATCH', `content ${uri} hash mismatch. A SHA-256 has 64 hexadecimal digits. In the owning session, use artifact_read with the URI only (omit expectedHash and selectors) to inspect the current hash; compare it with the original source before correcting the reference. Do not silently substitute changed content.`, {
          invariantId: 'S-CTX-01',
        });
      }
      const message = error instanceof SessionArtifactError || error instanceof Error ? error.message : String(error);
      throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', message, { invariantId: 'S-CTX-01' });
    }
  }

  private assertEvidenceInvariants(
    sessionId: string,
    evidence: EvidenceRecord,
    lookup: InvestigationLookup,
  ): void {
    assertSState01(evidence, lookup);
    assertObservedToolEvidenceHasArtifact(evidence);
    if (evidence.contentHashes.length !== evidence.artifactRefs.length) {
      throw new InvestigationError(
        'INVESTIGATION_HASH_MISMATCH',
        'contentHashes must correspond 1:1 with artifactRefs: each entry is the matching artifactRef expectedHash, not the capture hash.',
      );
    }
    for (const [index, ref] of evidence.artifactRefs.entries()) {
      this.assertContentRef(sessionId, ref.uri, ref.expectedHash);
      if (!hashesEqual(evidence.contentHashes[index], ref.expectedHash)) {
        throw new InvestigationError(
          'INVESTIGATION_HASH_MISMATCH',
          `contentHashes[${index}] does not match artifactRefs[${index}] current content`,
        );
      }
    }
    assertEvidenceLinks(evidence, lookup);
  }

  private applyEvidenceStale(
    sessionId: string,
    evidence: EvidenceRecord,
    lookup: InvestigationLookup,
  ): EvidenceRecord {
    const next = { ...evidence };
    const worldState = lookup.getWorldState(next.worldStateId);
    if (worldState) {
      const experiment = this.findExperimentForWorldState(sessionId, worldState.worldStateId);
      const verdict = evaluateSRdc01({ worldState, experiment, lookup });
      if (worldStateMarksEvidenceStale(worldState, verdict)) {
        next.stale = true;
      }
    }
    return next;
  }

  resolveBoundWorldStateId(
    kind: InvestigationArtifactKind,
    record: InvestigationRecord,
    inputWorldStateId: string | undefined,
    lookup: InvestigationLookup,
    ready: boolean,
  ): string | undefined {
    const inferred = inferWorldStateId(kind, record);
    const provided = inputWorldStateId?.trim() || undefined;
    if (provided && inferred && provided !== inferred) {
      throw worldStateBindError(ready, `worldStateId ${provided} does not match record body ${inferred}`);
    }
    const bound = inferred ?? provided;
    if (isWorldStateBoundKind(kind)) {
      if (!bound) {
        throw worldStateBindError(ready, 'bound record requires worldStateId');
      }
      if (!worldStateResolvable(kind, record, bound, lookup)) {
        throw worldStateBindError(ready, `worldState ${bound} is not resolvable`);
      }
      return bound;
    }
    if (provided && !worldStateResolvable(kind, record, provided, lookup)) {
      throw worldStateBindError(ready, `worldState ${provided} is not resolvable`);
    }
    return bound;
  }

  private findExperimentForWorldState(sessionId: string, worldStateId: string): ExperimentRecord | null {
    const entries = this.host.readIndex(sessionId).artifacts.filter((entry) => entry.kind === 'experiment' && entry.status !== 'superseded');
    for (const entry of entries) {
      const experiment = this.host.recordReader(sessionId).readRecordBodyOf(entry, 'ExperimentRecord');
      if (
        experiment.baselineWorldStateId === worldStateId
        || experiment.variantWorldStateId === worldStateId
        || experiment.restoredWorldStateId === worldStateId
      ) {
        return experiment;
      }
    }
    return null;
  }
}
