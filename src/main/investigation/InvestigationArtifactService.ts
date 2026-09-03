import * as path from 'path';
import { generateEventId } from '@shared/utils/id';
import {
  formatInvestigationContentHash,
  isCausalOrCounterfactualClaim,
  type ArtifactSourceRef,
  type ChallengeRecord,
  type ClaimRecord,
  type ClaimSet,
  type EvidencePack,
  type EvidenceRecord,
  type ExperimentRecord,
  type InvestigationArtifactKind,
  type InvestigationArtifactManifest,
  type InvestigationMission,
  type InvestigationRecord,
  type InvestigationReport,
  type WorldState,
} from '@shared/types/renderdocInvestigation';
import { SessionArtifactError } from '@shared/types/sessionArtifact';
import { SessionArtifactResolver, sessionArtifactResolver } from '../sessions/SessionArtifactResolver';
import { InvestigationError, isInvestigationStoreDegraded, toInvestigationError } from './investigationErrors';
import {
  collectStalePropagation,
  collectSupersede,
  upsertIndexEntry,
} from './investigationArtifactMutations';
import {
  commitInvestigationTxn,
  hasInvestigationTxnResidue,
  recoverInvestigationTxn,
  withInvestigationTxnLock,
  type InvestigationTxnIo,
  type InvestigationTxnMutation,
} from './investigationTxn';
import { hashesEqual, serializeInvestigationJson, sha256Prefixed } from './investigationHash';
import {
  assertChallengeRecordRefs,
  assertCheckpointRecordRefs,
  assertClaimRecordRefs,
  assertOptimizerExperimentClose,
  assertReportContractPresent,
  assertReportRecordRefs,
  assertSCausal01,
  assertSClaim01,
  assertSState01,
  collectProjectedClaims,
  evaluateSRdc01,
  worldStateMarksEvidenceStale,
  type InvestigationLookup,
} from './investigationInvariants';
import { requireInvestigationKind } from './investigationKindRegistry';
import {
  assertInvestigationIndexIntegrity,
  assertTripleContentHash,
  isReadySourceDriftError,
} from './investigationReadIntegrity';
import {
  collectRecordKeys,
  collectSupersedeChain,
  contentUriFor,
  directoryHasJson,
  emptyIndex,
  INDEX_URI,
  inferWorldStateId,
  isWorldStateBoundKind,
  manifestUriFor,
  recordKeyOf,
  recordKeyToken,
  type InvestigationIndexDocument,
  type InvestigationIndexEntry,
} from './investigationRecordKeys';
import {
  InvestigationArtifactManifestSchema,
  InvestigationIndexDocumentSchema,
  parseInvestigationRecord,
} from './investigationRecordSchemas';
import {
  rejectOpaqueWriteInput,
  requireCanonicalWriteMission,
  worldStateBindError,
  worldStateResolvable,
  type InvestigationArtifactServiceDeps,
  type InvestigationReadResult,
  type InvestigationWriteInput,
  type InvestigationWriteResult,
} from './investigationArtifactWrite';

export type { InvestigationIndexDocument, InvestigationIndexEntry } from './investigationRecordKeys';
export type {
  InvestigationArtifactServiceDeps,
  InvestigationReadResult,
  InvestigationWriteInput,
  InvestigationWriteResult,
} from './investigationArtifactWrite';

export class InvestigationArtifactService {
  private readonly resolver: SessionArtifactResolver;
  private readonly now: () => Date;
  private readonly onPersistBoundary?: InvestigationArtifactServiceDeps['onPersistBoundary'];
  private readonly lockMaxAttempts?: number;
  private readonly lockedSessions = new Set<string>();

  constructor(deps: InvestigationArtifactServiceDeps = {}) {
    this.resolver = deps.resolver ?? sessionArtifactResolver;
    this.now = deps.now ?? (() => new Date());
    this.onPersistBoundary = deps.onPersistBoundary;
    this.lockMaxAttempts = deps.lockMaxAttempts;
  }

  writeRecord(sessionId: string | null | undefined, input: InvestigationWriteInput): InvestigationWriteResult {
    this.assertSession(sessionId);
    return this.withSessionLock(sessionId, () => this.writeRecordLocked(sessionId, input));
  }

  private writeRecordLocked(sessionId: string, input: InvestigationWriteInput): InvestigationWriteResult {
    rejectOpaqueWriteInput(input);
    const kindEntry = requireInvestigationKind(input.kind);
    let parsed: InvestigationRecord;
    try {
      parsed = parseInvestigationRecord(kindEntry.recordType, input.record) as InvestigationRecord;
    } catch (error) {
      throw new InvestigationError(
        'INVESTIGATION_SCHEMA_INVALID',
        error instanceof Error ? error.message : String(error),
      );
    }
    const lookup = this.createRawLookup(sessionId);
    const mission = requireCanonicalWriteMission(kindEntry.kind, input.mission, parsed);
    this.assertRecordInvariants(sessionId, kindEntry.kind, parsed, lookup, mission);
    const artifactId = input.artifactId?.trim() || generateEventId('invart');
    const supersedes = input.supersedes?.trim() || undefined;
    this.assertUniqueIds(sessionId, {
      artifactId,
      kind: kindEntry.kind,
      record: parsed,
      supersedes,
    });
    const isolation = this.applyRdcIsolation(sessionId, kindEntry.kind, parsed, lookup);
    parsed = isolation.record;
    const contentUri = contentUriFor(artifactId);
    const contentText = serializeInvestigationJson(parsed);
    const contentHash = sha256Prefixed(contentText);
    const requestedReady = input.status === 'ready';
    if (kindEntry.kind === 'report' && requestedReady) {
      assertReportContractPresent(parsed as InvestigationReport, lookup, { mission });
    }
    const sourceRefs = input.sourceRefs ?? [];
    const worldStateId = this.resolveBoundWorldStateId(
      kindEntry.kind,
      parsed,
      input.worldStateId,
      lookup,
      requestedReady,
    );
    const manifest: InvestigationArtifactManifest = {
      artifactId,
      mission,
      kind: kindEntry.kind,
      status: requestedReady ? 'ready' : 'draft',
      title: input.title.trim(),
      summary: input.summary.trim(),
      contentRef: contentUri,
      sourceRefs,
      contentHash: formatInvestigationContentHash(contentHash),
      recordType: kindEntry.recordType,
      worldStateId,
      supersedes,
      createdAt: input.createdAt ?? this.now().toISOString(),
    };
    if (requestedReady) {
      this.assertReady(sessionId, manifest, contentText, lookup);
    } else {
      this.parseManifest(manifest);
    }
    const mutations: InvestigationTxnMutation[] = [];
    let workingIndex = this.readIndexSnapshot(sessionId);
    if (isolation.markEvidenceStaleFor) {
      const stale = collectStalePropagation(this.mutationReader(sessionId), isolation.markEvidenceStaleFor, workingIndex);
      mutations.push(...stale.mutations);
      workingIndex = stale.index;
    }
    let supersededArtifactId: string | undefined;
    if (manifest.supersedes) {
      const superseded = collectSupersede(this.mutationReader(sessionId), manifest.supersedes, workingIndex);
      mutations.push(...superseded.mutations);
      workingIndex = superseded.index;
      supersededArtifactId = superseded.artifactId;
    }
    mutations.push({ uri: contentUri, text: contentText, role: 'content' });
    mutations.push({
      uri: manifestUriFor(artifactId),
      text: serializeInvestigationJson(manifest),
      role: 'manifest',
    });
    workingIndex = upsertIndexEntry(workingIndex, {
      artifactId,
      kind: kindEntry.kind,
      recordType: kindEntry.recordType,
      status: manifest.status,
      contentUri,
      manifestUri: manifestUriFor(artifactId),
      contentHash: manifest.contentHash,
      createdAt: manifest.createdAt,
      supersedes: manifest.supersedes,
      recordKey: recordKeyOf(kindEntry.kind, parsed),
    });
    mutations.push({
      uri: INDEX_URI,
      text: serializeInvestigationJson(workingIndex),
      role: 'index',
    });
    this.commitMutations(sessionId, mutations);
    return { manifest, contentUri, contentHash: manifest.contentHash, record: parsed, supersededArtifactId };
  }

  readRecord(sessionId: string | null | undefined, artifactId: string, expectedHash?: string): InvestigationReadResult {
    this.assertSession(sessionId);
    return this.withSessionLock(sessionId, () => this.readRecordLocked(sessionId, artifactId, expectedHash));
  }

  private readRecordLocked(sessionId: string, artifactId: string, expectedHash?: string): InvestigationReadResult {
    const entry = this.findIndexEntry(sessionId, artifactId);
    if (!entry) {
      throw new InvestigationError('INVESTIGATION_NOT_FOUND', artifactId);
    }
    let manifest = this.parseManifest(this.readJson<InvestigationArtifactManifest>(sessionId, entry.manifestUri));
    const content = this.readArtifact(sessionId, entry.contentUri, {
      expectedHash: expectedHash ? expectedHash.replace(/^sha256:/i, '') : undefined,
    });
    if (content.truncated) {
      throw new InvestigationError('INVESTIGATION_HASH_MISMATCH', 'contentRef read was truncated');
    }
    if (expectedHash && !hashesEqual(expectedHash, content.hash)) {
      throw new InvestigationError('INVESTIGATION_HASH_MISMATCH', 'expectedHash does not match content');
    }
    const contentText = content.text ?? '';
    assertTripleContentHash(entry.contentHash, manifest.contentHash, contentText, content.hash);
    let record: InvestigationRecord;
    try {
      record = parseInvestigationRecord(entry.recordType, JSON.parse(contentText || '{}')) as InvestigationRecord;
    } catch (error) {
      throw toInvestigationError(error);
    }
    if (manifest.status === 'ready') {
      manifest = this.refreshReadyOnRead(sessionId, entry, manifest, contentText);
    }
    this.assertIndexedRecordInvariants(sessionId, entry.kind, record);
    return {
      manifest,
      record,
      contentUri: entry.contentUri,
      contentHash: formatInvestigationContentHash(content.hash),
    };
  }

  list(sessionId: string | null | undefined, filter?: { kind?: string; status?: string }): InvestigationIndexEntry[] {
    this.assertSession(sessionId);
    return this.withSessionLock(sessionId, () => {
    const entries = this.readIndex(sessionId).artifacts.filter((entry) => (
      (!filter?.kind || entry.kind === filter.kind) && (!filter?.status || entry.status === filter.status)
    ));
    const lookup = this.createLookup(sessionId);
    for (const entry of entries) {
      if (entry.status === 'superseded') continue;
      this.assertRecordInvariants(sessionId, entry.kind, this.readRecordBody<InvestigationRecord>(sessionId, entry), lookup);
    }
    return entries;
    });
  }

  listForProjection(sessionId: string | null | undefined): {
    artifacts: InvestigationIndexEntry[];
    storeDegraded: boolean;
  } {
    this.assertSession(sessionId);
    try {
      return this.withSessionLock(sessionId, () => ({
        artifacts: this.readIndexSnapshot(sessionId).artifacts,
        storeDegraded: false,
      }));
    } catch (error) {
      if (isInvestigationStoreDegraded(error)) {
        return { artifacts: [], storeDegraded: true };
      }
      throw error;
    }
  }

  listManifests(sessionId: string | null | undefined): Map<string, InvestigationArtifactManifest | null> {
    this.assertSession(sessionId);
    return this.withSessionLock(sessionId, () => {
    const manifests = new Map<string, InvestigationArtifactManifest | null>();
    for (const entry of this.readIndexSnapshot(sessionId).artifacts) {
      try { manifests.set(entry.artifactId, this.parseManifest(this.readJson(sessionId, entry.manifestUri))); }
      catch { manifests.set(entry.artifactId, null); }
    }
    return manifests;
    });
  }

  assertReady(
    sessionId: string,
    manifest: InvestigationArtifactManifest,
    contentText: string,
    lookup: InvestigationLookup = this.createRawLookup(sessionId),
  ): void {
    const kindEntry = requireInvestigationKind(manifest.kind);
    if (manifest.recordType !== kindEntry.recordType) {
      throw new InvestigationError('INVESTIGATION_READY_DENIED', 'recordType does not match Kind Registry');
    }
    if (manifest.sourceRefs.length < 1) {
      throw new InvestigationError('INVESTIGATION_READY_DENIED', 'ready requires sourceRefs.length >= 1');
    }
    for (const source of manifest.sourceRefs) {
      this.assertSourceRef(sessionId, source);
    }
    if (!hashesEqual(manifest.contentHash, sha256Prefixed(contentText))) {
      throw new InvestigationError('INVESTIGATION_READY_DENIED', 'contentHash must equal sha256 of contentRef bytes');
    }
    let record: InvestigationRecord;
    try {
      record = parseInvestigationRecord(kindEntry.recordType, JSON.parse(contentText)) as InvestigationRecord;
    } catch (error) {
      throw new InvestigationError(
        'INVESTIGATION_READY_DENIED',
        error instanceof Error ? error.message : String(error),
      );
    }
    this.resolveBoundWorldStateId(kindEntry.kind, record, manifest.worldStateId, lookup, true);
    if (kindEntry.kind === 'report') {
      const mission = requireCanonicalWriteMission(kindEntry.kind, manifest.mission, record);
      assertReportContractPresent(record as InvestigationReport, lookup, { mission });
    }
    this.parseManifest(manifest);
  }

  createLookup(sessionId: string): InvestigationLookup {
    return this.withSessionLock(sessionId, () => this.buildLookup(sessionId, true));
  }

  private createRawLookup(sessionId: string): InvestigationLookup {
    return this.buildLookup(sessionId, false);
  }

  private buildLookup(sessionId: string, verify: boolean): InvestigationLookup {
    const memo = new Map<string, InvestigationRecord | null>();
    const visiting = new Set<string>();
    const lookup = {} as InvestigationLookup;
    const take = <T>(kind: InvestigationArtifactKind, id: string): T | null => {
      if (!verify) return this.findRecord<T>(sessionId, kind, id);
      const key = `${kind}:${id}`;
      if (memo.has(key)) return memo.get(key) as T | null;
      const record = this.findRecord<T>(sessionId, kind, id);
      if (!record) {
        memo.set(key, null);
        return null;
      }
      if (visiting.has(key)) return record;
      visiting.add(key);
      try {
        this.assertRecordInvariants(sessionId, kind, record as unknown as InvestigationRecord, lookup);
        memo.set(key, record as unknown as InvestigationRecord);
        return record;
      } catch (error) {
        memo.clear();
        throw error;
      } finally {
        visiting.delete(key);
      }
    };
    lookup.getWorldState = (id) => take<WorldState>('world_state', id);
    lookup.getClaim = (id) => take<ClaimRecord>('claim', id);
    lookup.getEvidence = (id) => take<EvidenceRecord>('evidence', id);
    lookup.getExperiment = (id) => take<ExperimentRecord>('experiment', id);
    lookup.getChallenge = (id) => take<{ challengeId: string }>('challenge', id);
    lookup.getArtifact = (id) => this.findIndexEntry(sessionId, id) ?? null;
    return lookup;
  }

  private assertIndexedRecordInvariants(
    sessionId: string,
    kind: InvestigationArtifactKind,
    record: InvestigationRecord,
  ): void {
    this.assertRecordInvariants(sessionId, kind, record, this.createLookup(sessionId));
  }

  private assertRecordInvariants(
    sessionId: string,
    kind: InvestigationArtifactKind,
    record: InvestigationRecord,
    lookup: InvestigationLookup,
    mission?: InvestigationMission,
  ): void {
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
        assertClaimRecordRefs(claim, lookup, { mission });
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
        assertSClaim01(claim, lookup);
        if (isCausalOrCounterfactualClaim(claim)) assertSCausal01(claim, lookup);
      }
    }
  }

  private applyRdcIsolation(
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

  private assertSourceRef(sessionId: string, source: ArtifactSourceRef): void {
    const entry = this.findIndexEntry(sessionId, source.artifactId);
    if (!entry) {
      throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `source artifact ${source.artifactId}`, {
        invariantId: 'S-CTX-01',
      });
    }
    try {
      const read = this.resolver.read(sessionId, entry.contentUri, {
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
      this.resolver.read(sessionId, uri, { expectedHash: expectedHash.replace(/^sha256:/i, '') });
    } catch (error) {
      if (error instanceof InvestigationError) throw error;
      if (error instanceof SessionArtifactError && error.code === 'ARTIFACT_HASH_MISMATCH') {
        throw new InvestigationError('INVESTIGATION_HASH_MISMATCH', `content ${uri} hash mismatch`, {
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
    if (evidence.contentHashes.length !== evidence.artifactRefs.length) {
      throw new InvestigationError(
        'INVESTIGATION_HASH_MISMATCH',
        'contentHashes must correspond 1:1 with artifactRefs',
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
    for (const claimId of evidence.claimIds) {
      if (!lookup.getClaim(claimId)) {
        throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `evidence claim ${claimId}`, {
          invariantId: 'S-CTX-01',
        });
      }
    }
    if (evidence.experimentId && !lookup.getExperiment(evidence.experimentId)) {
      throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `experiment ${evidence.experimentId}`, {
        invariantId: 'S-CTX-01',
      });
    }
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

  private resolveBoundWorldStateId(
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
    const entries = this.readIndex(sessionId).artifacts.filter((entry) => entry.kind === 'experiment' && entry.status !== 'superseded');
    for (const entry of entries) {
      const experiment = this.readRecordBody<ExperimentRecord>(sessionId, entry);
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

  private mutationReader(sessionId: string) {
    return {
      readRecordBody: <T>(entry: InvestigationIndexEntry) => this.readRecordBody<T>(sessionId, entry),
      readJson: <T>(uri: string) => this.readJson<T>(sessionId, uri),
      parseManifest: (value: unknown) => this.parseManifest(value),
    };
  }

  private refreshReadyOnRead(
    sessionId: string,
    entry: InvestigationIndexEntry,
    manifest: InvestigationArtifactManifest,
    contentText: string,
  ): InvestigationArtifactManifest {
    try {
      this.assertReady(sessionId, manifest, contentText);
      return manifest;
    } catch (error) {
      if (!isReadySourceDriftError(error)) throw error;
      const next = { ...manifest, status: 'stale' as const };
      const index = upsertIndexEntry(this.readIndexSnapshot(sessionId), { ...entry, status: 'stale' });
      this.commitMutations(sessionId, [
        { uri: entry.manifestUri, text: serializeInvestigationJson(next), role: 'stale' },
        { uri: INDEX_URI, text: serializeInvestigationJson(index), role: 'index' },
      ]);
      return this.parseManifest(next);
    }
  }

  private findRecord<T>(sessionId: string, kind: InvestigationArtifactKind, recordKey: string): T | null {
    const live = this.readIndex(sessionId).artifacts.filter((entry) => entry.status !== 'superseded');
    const standalone = live.filter((entry) => entry.kind === kind && entry.recordKey === recordKey).at(-1);
    if (standalone) return this.readRecordBody<T>(sessionId, standalone);
    const packKind = kind === 'claim' ? 'claim_set' : kind === 'evidence' ? 'evidence_pack' : undefined;
    if (!packKind) return null;
    type Member = { claimId?: string; evidenceId?: string; cardId?: string };
    for (const entry of live.filter((item) => item.kind === packKind).reverse()) {
      const match = this.readRecordBody<{ items?: Member[] }>(sessionId, entry).items?.find((item) => (
        item.claimId === recordKey || item.evidenceId === recordKey || item.cardId === recordKey
      ));
      if (match) return match as T;
    }
    return null;
  }

  private readRecordBody<T>(sessionId: string, entry: InvestigationIndexEntry): T {
    const read = this.readArtifact(sessionId, entry.contentUri);
    if (read.truncated) {
      throw new InvestigationError('INVESTIGATION_HASH_MISMATCH', 'contentRef read was truncated');
    }
    const contentText = read.text ?? '';
    assertTripleContentHash(entry.contentHash, entry.contentHash, contentText, read.hash);
    try {
      return JSON.parse(contentText || '{}') as T;
    } catch (error) {
      throw toInvestigationError(error);
    }
  }

  private findIndexEntry(sessionId: string, artifactId: string): InvestigationIndexEntry | undefined {
    return this.readIndex(sessionId).artifacts.find((entry) => entry.artifactId === artifactId);
  }

  private assertIndexIntegrity(sessionId: string, index: InvestigationIndexDocument): void {
    assertInvestigationIndexIntegrity(index, {
      readManifest: (uri) => this.readJson(sessionId, uri),
      readContent: (uri) => {
        const read = this.readArtifact(sessionId, uri);
        return { text: read.text ?? '', hash: read.hash, truncated: Boolean(read.truncated) };
      },
      parseManifest: (value) => this.parseManifest(value),
    });
  }

  private readIndex(sessionId: string): InvestigationIndexDocument {
    const parsed = this.readIndexSnapshot(sessionId);
    this.assertIndexIntegrity(sessionId, parsed);
    return parsed;
  }

  private readIndexSnapshot(sessionId: string): InvestigationIndexDocument {
    try {
      const read = this.readArtifact(sessionId, INDEX_URI);
      if (read.truncated) {
        throw new InvestigationError('INVESTIGATION_INDEX_CORRUPT', 'investigation index read was truncated');
      }
      try {
        return InvestigationIndexDocumentSchema.parse(JSON.parse(read.text ?? ''));
      } catch (error) {
        if (error instanceof InvestigationError) throw error;
        throw new InvestigationError('INVESTIGATION_INDEX_CORRUPT', 'investigation index is corrupt');
      }
    } catch (error) {
      if (error instanceof InvestigationError) throw error;
      if (error instanceof SessionArtifactError && error.code === 'ARTIFACT_NOT_FOUND') {
        if (this.hasSiblingInvestigationFiles(sessionId)) {
          throw new InvestigationError('INVESTIGATION_INDEX_MISSING', 'investigation index is missing');
        }
        if (this.hasTxnResidue(sessionId)) {
          throw new InvestigationError('INVESTIGATION_DEGRADED', 'partial investigation transaction is visible');
        }
        return emptyIndex();
      }
      throw new InvestigationError(
        'INVESTIGATION_INDEX_CORRUPT',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private hasSiblingInvestigationFiles(sessionId: string): boolean {
    try {
      const resolved = this.resolver.resolve(sessionId, INDEX_URI);
      const root = path.dirname(resolved.absolutePath);
      return directoryHasJson(path.join(root, 'records')) || directoryHasJson(path.join(root, 'manifests'));
    } catch {
      return false;
    }
  }

  private hasTxnResidue(sessionId: string): boolean {
    try {
      return hasInvestigationTxnResidue(this.resolver.resolve(sessionId, INDEX_URI).sessionPath);
    } catch {
      return false;
    }
  }

  private assertUniqueIds(
    sessionId: string,
    input: {
      artifactId: string;
      kind: InvestigationArtifactKind;
      record: InvestigationRecord;
      supersedes?: string;
    },
  ): void {
    if (input.supersedes && !this.findIndexEntry(sessionId, input.supersedes)) {
      throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `supersedes ${input.supersedes}`);
    }
    const index = this.readIndex(sessionId);
    if (index.artifacts.some((entry) => entry.artifactId === input.artifactId)) {
      throw new InvestigationError('INVESTIGATION_DUPLICATE_ID', `artifactId ${input.artifactId} already exists`);
    }
    const incoming = collectRecordKeys(input.kind, input.record);
    const incomingSet = new Set<string>();
    for (const key of incoming) {
      const token = recordKeyToken(key);
      if (incomingSet.has(token)) {
        throw new InvestigationError(
          'INVESTIGATION_DUPLICATE_ID',
          `record id ${key.id} is repeated inside the write payload`,
        );
      }
      incomingSet.add(token);
    }
    const reuseChain = collectSupersedeChain(index.artifacts, input.supersedes);
    for (const entry of index.artifacts) {
      if (reuseChain.has(entry.artifactId)) continue;
      const existing = collectRecordKeys(entry.kind, this.readRecordBody<InvestigationRecord>(sessionId, entry));
      const clash = existing.find((key) => incomingSet.has(recordKeyToken(key)));
      if (clash) {
        throw new InvestigationError(
          'INVESTIGATION_DUPLICATE_ID',
          `record id ${clash.id} already exists; version updates must use supersedes`,
        );
      }
    }
  }

  private commitMutations(sessionId: string, mutations: InvestigationTxnMutation[]): void {
    try {
      commitInvestigationTxn(sessionId, mutations, this.txnIo(), {
        onPersistBoundary: this.onPersistBoundary,
      });
    } catch (error) {
      throw error instanceof InvestigationError ? error : toInvestigationError(error);
    }
  }

  private recoverStore(sessionId: string): void {
    recoverInvestigationTxn(sessionId, this.txnIo());
  }

  private txnIo(): InvestigationTxnIo {
    return {
      resolve: (id, uri) => this.resolver.resolve(id, uri),
      write: (id, uri, text) => this.resolver.write(id, uri, text, { mimeType: 'application/json' }),
    };
  }

  private withSessionLock<T>(sessionId: string, operation: () => T): T {
    if (this.lockedSessions.has(sessionId)) return operation();
    const sessionPath = this.resolver.resolve(sessionId, INDEX_URI).sessionPath;
    return withInvestigationTxnLock(sessionPath, () => {
      this.lockedSessions.add(sessionId);
      try {
        this.recoverStore(sessionId);
        return operation();
      } finally {
        this.lockedSessions.delete(sessionId);
      }
    }, { maxAttempts: this.lockMaxAttempts });
  }

  private parseManifest(value: unknown): InvestigationArtifactManifest {
    try {
      return InvestigationArtifactManifestSchema.parse(value);
    } catch (error) {
      throw toInvestigationError(error);
    }
  }

  private readJson<T>(sessionId: string, uri: string): T {
    const read = this.readArtifact(sessionId, uri);
    try {
      return JSON.parse(read.text ?? '{}') as T;
    } catch (error) {
      throw toInvestigationError(error);
    }
  }

  private readArtifact(
    sessionId: string,
    uri: string,
    options?: { expectedHash?: string },
  ) {
    try {
      return this.resolver.read(sessionId, uri, options);
    } catch (error) {
      if (error instanceof SessionArtifactError) throw error;
      throw toInvestigationError(error);
    }
  }

  private assertSession(sessionId: string | null | undefined): asserts sessionId is string {
    if (!sessionId?.trim()) {
      throw new InvestigationError('INVESTIGATION_SESSION_DENIED', 'an owning session is required.');
    }
  }
}

export const investigationArtifactService = new InvestigationArtifactService();
