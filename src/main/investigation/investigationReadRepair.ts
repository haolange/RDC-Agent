import type { InvestigationArtifactManifest } from '@shared/types/renderdocInvestigation';
import {
  collectRetiredClaimDependents,
  collectSupersededWorldStateDependents,
  upsertIndexEntry,
} from './investigationArtifactMutations';
import { InvestigationError } from './investigationErrors';
import { serializeInvestigationJson, sha256Prefixed } from './investigationHash';
import { collectRecordKeys, type InvestigationIndexDocument, type InvestigationIndexEntry } from './investigationRecordKeys';
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
    if (!index.artifacts.some((entry) => (entry.kind === 'world_state' || entry.kind === 'claim' || entry.kind === 'claim_set')
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
    const reader = {
      readRecordBody: <T>(entry: InvestigationIndexEntry) => this.access.readRecordBody<T>(sessionId, entry),
      readJson: <T>(uri: string) => this.access.readJson<T>(sessionId, uri),
      parseManifest: (value: unknown) => this.access.parseManifest(value),
    };
    const mutations: InvestigationTxnMutation[] = [];
    for (const worldStateId of orphanedIds) {
      const stale = collectSupersededWorldStateDependents(reader, worldStateId, index);
      mutations.push(...stale.mutations);
      index = stale.index;
    }
    const currentClaimIds = new Set(index.artifacts
      .filter(entry => (entry.kind === 'claim' || entry.kind === 'claim_set') && entry.status !== 'superseded')
      .flatMap(entry => collectRecordKeys(entry.kind, reader.readRecordBody<InvestigationRecord>(entry))
        .filter(key => key.space === 'claim').map(key => key.id)));
    const retiredClaimIds = new Set(index.artifacts
      .filter(entry => (entry.kind === 'claim' || entry.kind === 'claim_set') && entry.status === 'superseded')
      .flatMap(entry => collectRecordKeys(entry.kind, reader.readRecordBody<InvestigationRecord>(entry))
        .filter(key => key.space === 'claim' && !currentClaimIds.has(key.id)).map(key => key.id)));
    const staleClaimDependents = collectRetiredClaimDependents(reader, retiredClaimIds, index);
    mutations.push(...staleClaimDependents.mutations);
    index = staleClaimDependents.index;
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
