import type { InvestigationArtifactManifest } from '@shared/types/renderdocInvestigation';
import {
  collectRetiredRecordDependents,
  collectSupersededWorldStateDependents,
  upsertIndexEntry,
  withPendingInvestigationMutations,
} from './investigationArtifactMutations';
import { InvestigationError } from './investigationErrors';
import { serializeInvestigationJson, sha256Prefixed } from './investigationHash';
import { collectRecordKeys, recordKeyToken, type InvestigationIndexDocument, type InvestigationIndexEntry } from './investigationRecordKeys';
import type { InvestigationRecord } from '@shared/types/renderdocInvestigation';
import { INDEX_URI } from './investigationRecordKeys';
import { isReadySourceDriftError } from './investigationReadIntegrity';
import type { InvestigationTxnMutation } from './investigationTxn';

interface ReadRepairAccess {
  readIndex(sessionId: string): InvestigationIndexDocument;
  readIndexSnapshot(sessionId: string): InvestigationIndexDocument;
  readRecordBody<T>(sessionId: string, entry: InvestigationIndexEntry): T;
  readJson<T>(sessionId: string, uri: string): T;
  parseManifest(value: unknown): InvestigationArtifactManifest;
  assertReady(sessionId: string, manifest: InvestigationArtifactManifest, contentText: string): void;
  commitMutations(sessionId: string, mutations: InvestigationTxnMutation[]): void;
}

export class InvestigationReadRepair {
  private lastProjectionReconciliation: { sessionId: string; indexHash: string } | null = null;

  constructor(private readonly access: ReadRepairAccess) {}

  projectionIndex(sessionId: string): InvestigationIndexDocument {
    let index = this.access.readIndexSnapshot(sessionId);
    if (!index.artifacts.some((entry) => (entry.kind === 'world_state' || entry.kind === 'claim' || entry.kind === 'claim_set'
      || entry.kind === 'evidence' || entry.kind === 'evidence_pack')
      && entry.status === 'superseded')) {
      return index;
    }
    const indexHash = sha256Prefixed(serializeInvestigationJson(index));
    if (this.lastProjectionReconciliation?.sessionId !== sessionId
      || this.lastProjectionReconciliation.indexHash !== indexHash) {
      this.reconcileSupersededRecordDependents(sessionId);
      index = this.access.readIndexSnapshot(sessionId);
      this.lastProjectionReconciliation = {
        sessionId,
        indexHash: sha256Prefixed(serializeInvestigationJson(index)),
      };
    }
    return index;
  }

  reconcileSupersededRecordDependents(sessionId: string): void {
    let index: InvestigationIndexDocument;
    let integrityError: unknown;
    try {
      index = this.access.readIndex(sessionId);
    } catch (error) {
      if (!(error instanceof InvestigationError) || error.code !== 'INVESTIGATION_READY_DENIED') throw error;
      integrityError = error;
      index = this.access.readIndexSnapshot(sessionId);
    }
    const currentWorldStateIds = new Set(index.artifacts
      .filter((entry) => entry.kind === 'world_state' && entry.status !== 'superseded')
      .map((entry) => entry.recordKey));
    const orphanedIds = new Set(index.artifacts
      .filter((entry) => entry.kind === 'world_state' && entry.status === 'superseded'
        && !currentWorldStateIds.has(entry.recordKey))
      .map((entry) => entry.recordKey));
    const mutations: InvestigationTxnMutation[] = [];
    const reader = withPendingInvestigationMutations({
      readRecordBody: <T>(entry: InvestigationIndexEntry) => this.access.readRecordBody<T>(sessionId, entry),
      readJson: <T>(uri: string) => this.access.readJson<T>(sessionId, uri),
      parseManifest: (value: unknown) => this.access.parseManifest(value),
    }, mutations);
    for (const worldStateId of orphanedIds) {
      const stale = collectSupersededWorldStateDependents(reader, worldStateId, index);
      mutations.push(...stale.mutations);
      index = stale.index;
    }
    const currentRecordKeys = new Set(index.artifacts
      .filter(entry => entry.status !== 'superseded')
      .flatMap(entry => collectRecordKeys(entry.kind, reader.readRecordBody<InvestigationRecord>(entry))
        .map(recordKeyToken)));
    const retiredRecordKeys = new Set(index.artifacts
      .filter(entry => entry.status === 'superseded')
      .flatMap(entry => collectRecordKeys(entry.kind, reader.readRecordBody<InvestigationRecord>(entry))
        .filter(key => (key.space === 'claim' || key.space === 'evidence') && !currentRecordKeys.has(recordKeyToken(key)))
        .map(recordKeyToken)));
    const staleDependents = collectRetiredRecordDependents(reader, retiredRecordKeys, index);
    mutations.push(...staleDependents.mutations);
    index = staleDependents.index;
    if (mutations.length === 0) {
      if (integrityError) throw integrityError;
      return;
    }
    this.access.commitMutations(sessionId, [
      ...mutations,
      { uri: INDEX_URI, text: serializeInvestigationJson(index), role: 'index' },
    ]);
    this.access.readIndex(sessionId);
  }

  refreshReadyOnRead(
    sessionId: string,
    entry: InvestigationIndexEntry,
    manifest: InvestigationArtifactManifest,
    contentText: string,
  ): InvestigationArtifactManifest {
    try {
      this.access.assertReady(sessionId, manifest, contentText);
      return manifest;
    } catch (error) {
      if (!isReadySourceDriftError(error)) throw error;
      const next = { ...manifest, status: 'stale' as const };
      const index = upsertIndexEntry(this.access.readIndexSnapshot(sessionId), { ...entry, status: 'stale' });
      this.access.commitMutations(sessionId, [
        { uri: entry.manifestUri, text: serializeInvestigationJson(next), role: 'stale' },
        { uri: INDEX_URI, text: serializeInvestigationJson(index), role: 'index' },
      ]);
      return this.access.parseManifest(next);
    }
  }
}
