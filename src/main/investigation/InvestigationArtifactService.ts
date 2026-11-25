import * as path from 'path';
import { generateEventId } from '@shared/utils/id';
import { formatInvestigationContentHash, type ChallengeRecord, type ClaimRecord, type EvidenceRecord, type ExperimentRecord, type InvestigationArtifactKind, type InvestigationArtifactManifest, type InvestigationRecord, type InvestigationReport, type WorldState } from '@shared/types/renderdocInvestigation';
import { SessionArtifactError } from '@shared/types/sessionArtifact';
import { RdcExecutionReceipts } from '../rdc/RdcExecutionReceipts';
import { SessionArtifactResolver, sessionArtifactResolver } from '../sessions/artifacts/SessionArtifactResolver';
import { readCompleteInvestigationArtifact } from './investigationArtifactRead';
import { assertExecutionEvidence } from './investigationExecutionEvidence';
import { InvestigationError, isInvestigationStoreDegraded, toInvestigationError } from './investigationErrors';
import {
  collectStalePropagation,
  collectSupersededWorldStateDependents,
  collectSupersede,
  retiredRecordKeysForReplacement,
  upsertIndexEntry,
  withPendingInvestigationMutations, type InvestigationMutationReader,
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
import { assertReadyObservedEvidence, assertReportContractPresent, type InvestigationLookup } from './investigationInvariants';
import { requireInvestigationKind } from './investigationKindRegistry';
import {
  assertInvestigationIndexIntegrity,
  assertReadySourcesUnchanged,
  assertTripleContentHash,
  parseVerifiedRecordBody, parseVerifiedRecordBodyOf,
} from './investigationReadIntegrity';
import { InvestigationReadRepair } from './investigationReadRepair';
import { InvestigationRecordChecks } from './investigationRecordChecks';
import { collectRecordKeys, collectSupersedeChain, contentUriFor, directoryHasJson, emptyIndex, INDEX_URI, manifestUriFor, recordKeyOf, recordKeyToken, type InvestigationIndexDocument, type InvestigationIndexEntry } from './investigationRecordKeys';
import {
  InvestigationArtifactManifestSchema,
  InvestigationIndexDocumentSchema,
  parseInvestigationRecord,
  parseInvestigationWriteRecord,
} from './investigationRecordSchemas';
import { rejectOpaqueWriteInput, requireCanonicalWriteMission, type InvestigationArtifactServiceDeps, type InvestigationReadResult, type InvestigationWriteInput, type InvestigationWriteResult } from './investigationArtifactWrite';

export type { InvestigationIndexDocument, InvestigationIndexEntry } from './investigationRecordKeys';
export type {
  InvestigationArtifactServiceDeps,
  InvestigationReadResult,
  InvestigationWriteInput,
  InvestigationWriteResult,
} from './investigationArtifactWrite';

export class InvestigationArtifactService {
  private readonly receiptStore: RdcExecutionReceipts;
  private readonly resolver: SessionArtifactResolver;
  private readonly recordChecks: InvestigationRecordChecks;
  private readonly now: () => Date;
  private readonly onPersistBoundary?: InvestigationArtifactServiceDeps['onPersistBoundary'];
  private readonly lockMaxAttempts?: number;
  private readonly lockedSessions = new Set<string>();
  private readonly verifiedIndexes = new Map<string, InvestigationIndexDocument>();
  private readonly readRepair: InvestigationReadRepair;

  constructor(deps: InvestigationArtifactServiceDeps = {}) {
    this.resolver = deps.resolver ?? sessionArtifactResolver;
    this.receiptStore = deps.receiptStore ?? new RdcExecutionReceipts(this.resolver);
    this.recordChecks = new InvestigationRecordChecks({
      resolver: this.resolver,
      receiptStore: this.receiptStore,
      findIndexEntry: (sessionId, artifactId) => this.findIndexEntry(sessionId, artifactId),
      readIndex: (sessionId) => this.readIndex(sessionId),
      recordReader: (sessionId) => this.recordReader(sessionId),
    });
    this.now = deps.now ?? (() => new Date());
    this.onPersistBoundary = deps.onPersistBoundary;
    this.lockMaxAttempts = deps.lockMaxAttempts;
    this.readRepair = new InvestigationReadRepair({
      readIndex: (sessionId) => this.readIndex(sessionId),
      readIndexSnapshot: (sessionId) => this.readIndexSnapshot(sessionId),
      readRecordBody: (sessionId, entry) => this.recordReader(sessionId).readRecordBody(entry),
      readRecordBodyOf: (sessionId, entry, recordType) => this.recordReader(sessionId).readRecordBodyOf(entry, recordType),
      readJson: (sessionId: string, uri: string) => this.readJson(sessionId, uri),
      parseManifest: (value) => this.parseManifest(value),
      assertReady: (sessionId, manifest, contentText) => this.assertReady(sessionId, manifest, contentText),
      commitMutations: (sessionId, mutations) => this.commitMutations(sessionId, mutations),
    });
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
      parsed = parseInvestigationWriteRecord(kindEntry.recordType, input.record);
    } catch (error) {
      throw new InvestigationError('INVESTIGATION_SCHEMA_INVALID', error instanceof Error ? error.message : String(error));
    }
    const lookup = this.createRawLookup(sessionId);
    const mission = requireCanonicalWriteMission(kindEntry.kind, input.mission, parsed);
    this.recordChecks.assertRecordInvariants(sessionId, kindEntry.kind, parsed, lookup, mission);
    if (input.status === 'ready') assertReadyObservedEvidence(kindEntry.kind, parsed, lookup);
    if (kindEntry.kind === 'experiment') this.assertExecutionEvidence(sessionId, parsed as ExperimentRecord);
    if (kindEntry.kind === 'report' && input.status === 'ready') {
      for (const id of (parsed as InvestigationReport).experimentIds) {
        const experiment = lookup.getExperiment(id);
        if (experiment) this.assertExecutionEvidence(sessionId, experiment);
      }
    }
    const artifactId = input.artifactId?.trim() || generateEventId('invart');
    const supersedes = input.supersedes?.trim() || undefined;
    this.assertUniqueIds(sessionId, {
      artifactId,
      kind: kindEntry.kind,
      record: parsed,
      supersedes,
    });
    const isolation = this.recordChecks.applyRdcIsolation(sessionId, kindEntry.kind, parsed, lookup);
    parsed = isolation.record;
    const contentUri = contentUriFor(artifactId);
    const contentText = serializeInvestigationJson(parsed);
    const contentHash = sha256Prefixed(contentText);
    const requestedReady = input.status === 'ready';
    if (kindEntry.kind === 'report' && requestedReady) {
      assertReportContractPresent(parsed as InvestigationReport, lookup, { mission });
    }
    const sourceRefs = input.sourceRefs ?? [];
    const worldStateId = this.recordChecks.resolveBoundWorldStateId(
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
    const mutationReader = withPendingInvestigationMutations(this.recordReader(sessionId), mutations);
    let workingIndex = this.readIndexSnapshot(sessionId);
    if (isolation.markEvidenceStaleFor) {
      const stale = collectStalePropagation(mutationReader, isolation.markEvidenceStaleFor, workingIndex);
      mutations.push(...stale.mutations);
      workingIndex = stale.index;
    }
    let supersededArtifactId: string | undefined;
    if (manifest.supersedes) {
      const replaced = workingIndex.artifacts.find((entry) => entry.artifactId === manifest.supersedes);
      const retiredRecordKeys = retiredRecordKeysForReplacement(mutationReader, replaced, kindEntry.kind, parsed);
      const superseded = collectSupersede(mutationReader, manifest.supersedes, workingIndex, retiredRecordKeys);
      mutations.push(...superseded.mutations);
      workingIndex = superseded.index;
      supersededArtifactId = superseded.artifactId;
      if (kindEntry.kind === 'world_state' && replaced?.kind === 'world_state'
        && replaced.recordKey !== (parsed as WorldState).worldStateId) {
        const stale = collectSupersededWorldStateDependents(mutationReader, replaced.recordKey, workingIndex);
        mutations.push(...stale.mutations);
        workingIndex = stale.index;
      }
    }
    if (requestedReady) assertReadySourcesUnchanged(sourceRefs, workingIndex);
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
    return this.withSessionLock(sessionId, () => {
      this.readRepair.reconcileSupersededRecordDependents(sessionId);
      return this.readReconciledRecord(sessionId, artifactId, expectedHash);
    });
  }

  private readReconciledRecord(sessionId: string, artifactId: string, expectedHash?: string): InvestigationReadResult {
    const entry = this.findIndexEntry(sessionId, artifactId);
    if (!entry) {
      throw new InvestigationError('INVESTIGATION_NOT_FOUND', artifactId);
    }
    let manifest = this.parseManifest(this.readJson(sessionId, entry.manifestUri));
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
      record = parseInvestigationRecord(entry.recordType, JSON.parse(contentText || '{}'));
    } catch (error) {
      throw toInvestigationError(error);
    }
    if (manifest.status === 'ready') {
      manifest = this.readRepair.refreshReadyOnRead(sessionId, entry, manifest, contentText);
    }
    // A superseded version remains readable for audit and compaction, while
    // its replacement owns the current semantic invariants. Hash, schema,
    // manifest, and index integrity are still checked above.
    if (entry.status === 'ready' || entry.status === 'draft') {
      this.assertIndexedRecordInvariants(sessionId, entry.kind, record);
    }
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
    this.readRepair.reconcileSupersededRecordDependents(sessionId);
    const entries = this.readIndex(sessionId).artifacts.filter((entry) => (
      (!filter?.kind || entry.kind === filter.kind) && (!filter?.status || entry.status === filter.status)
    ));
    const lookup = this.createLookup(sessionId);
    for (const entry of entries) {
      if (entry.status !== 'ready' && entry.status !== 'draft') continue;
      this.recordChecks.assertRecordInvariants(sessionId, entry.kind, this.recordReader(sessionId).readRecordBody(entry), lookup);
    }
    return entries;
    });
  }
  /** Reconcile the graph once per locked archive; each body still receives full integrity checks. */
  readAllRecords(sessionId: string | null | undefined): InvestigationReadResult[] {
    this.assertSession(sessionId); return this.withSessionLock(sessionId, () =>
      this.list(sessionId).map(entry => this.readReconciledRecord(sessionId, entry.artifactId)));
  }
  listForProjection(sessionId: string | null | undefined): {
    artifacts: InvestigationIndexEntry[];
    storeDegraded: boolean;
  } {
    this.assertSession(sessionId);
    try {
      return this.withSessionLock(sessionId, () => ({
        artifacts: this.readRepair.projectionIndex(sessionId).artifacts,
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
      this.recordChecks.assertSourceRef(sessionId, source);
    }
    if (!hashesEqual(manifest.contentHash, sha256Prefixed(contentText))) {
      throw new InvestigationError('INVESTIGATION_READY_DENIED', 'contentHash must equal sha256 of contentRef bytes');
    }
    let record: InvestigationRecord;
    try {
      record = parseInvestigationRecord(kindEntry.recordType, JSON.parse(contentText));
    } catch (error) {
      throw new InvestigationError(
        'INVESTIGATION_READY_DENIED',
        error instanceof Error ? error.message : String(error),
      );
    }
    this.recordChecks.resolveBoundWorldStateId(kindEntry.kind, record, manifest.worldStateId, lookup, true);
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
    const take = <T extends InvestigationRecord>(kind: InvestigationArtifactKind, id: string): T | null => {
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
        this.recordChecks.assertRecordInvariants(sessionId, kind, record, lookup);
        memo.set(key, record);
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
    lookup.getChallenge = (id) => take<ChallengeRecord>('challenge', id);
    lookup.getArtifact = (id) => this.findIndexEntry(sessionId, id) ?? null;
    return lookup;
  }

  private assertIndexedRecordInvariants(
    sessionId: string,
    kind: InvestigationArtifactKind,
    record: InvestigationRecord,
  ): void {
    this.recordChecks.assertRecordInvariants(sessionId, kind, record, this.createLookup(sessionId));
  }

  /** Record bodies verified against the index and validated against their record type's schema. */
  assertExecutionEvidence(sessionId: string, experiment: ExperimentRecord): void {
    assertExecutionEvidence(sessionId, experiment, this.receiptStore);
  }

  private recordReader(sessionId: string): InvestigationMutationReader {
    const content = (entry: InvestigationIndexEntry) => {
      const read = this.readArtifact(sessionId, entry.contentUri);
      return { ...read, text: read.text ?? '' };
    };
    return {
      readRecordBody: (entry) => parseVerifiedRecordBody(entry, content(entry)),
      readRecordBodyOf: (entry, recordType) => parseVerifiedRecordBodyOf(entry, content(entry), recordType),
      readJson: (uri) => this.readJson(sessionId, uri),
      parseManifest: (value) => this.parseManifest(value),
    };
  }

  private findRecord<T extends InvestigationRecord>(sessionId: string, kind: InvestigationArtifactKind, recordKey: string): T | null {
    const live = this.readIndex(sessionId).artifacts.filter((entry) => entry.status !== 'superseded');
    const standalone = live.filter((entry) => entry.kind === kind && entry.recordKey === recordKey).at(-1);
    // Historical lifecycle records stay readable by artifact ID, not as current semantic refs.
    if (standalone?.status === 'stale' && (kind === 'challenge' || kind === 'experiment')) return null;
    const reader = this.recordReader(sessionId);
    if (standalone) return reader.readRecordBody(standalone) as T;
    if (kind !== 'claim' && kind !== 'evidence') return null;
    for (const entry of live.filter((item) => item.kind === (kind === 'claim' ? 'claim_set' : 'evidence_pack')).reverse()) {
      const match = kind === 'claim' ? reader.readRecordBodyOf(entry, 'ClaimSet').items.find((item) => item.claimId === recordKey)
        : reader.readRecordBodyOf(entry, 'EvidencePack').items.find((item) => item.evidenceId === recordKey);
      if (match) return match as T;
    }
    return null;
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
    const verified = this.verifiedIndexes.get(sessionId);
    if (verified) return verified;
    const parsed = this.readIndexSnapshot(sessionId);
    this.assertIndexIntegrity(sessionId, parsed);
    if (this.lockedSessions.has(sessionId)) this.verifiedIndexes.set(sessionId, parsed);
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
      const existing = collectRecordKeys(entry.kind, this.recordReader(sessionId).readRecordBody(entry));
      const clash = existing.find((key) => incomingSet.has(recordKeyToken(key)));
      if (clash) {
        const claimSetHint = input.kind === 'claim_set' && clash.space === 'claim'
          ? '; ClaimSet.items define new Claims and cannot repeat IDs from previously written Claims; cite existing Claims in supports/contradicts or use new item IDs'
          : '';
        throw new InvestigationError(
          'INVESTIGATION_DUPLICATE_ID',
          `record id ${clash.id} already exists; version updates must use supersedes${claimSetHint}`,
        );
      }
    }
  }

  private commitMutations(sessionId: string, mutations: InvestigationTxnMutation[]): void {
    this.verifiedIndexes.delete(sessionId);
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
        this.verifiedIndexes.delete(sessionId);
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

  private readJson(sessionId: string, uri: string): unknown {
    const read = this.readArtifact(sessionId, uri);
    try {
      return JSON.parse(read.text ?? '{}');
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
      return readCompleteInvestigationArtifact(this.resolver, sessionId, uri, options);
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
