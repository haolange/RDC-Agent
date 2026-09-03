import type {
  EvidencePack,
  EvidenceRecord,
  InvestigationArtifactManifest,
  InvestigationRecord,
} from '@shared/types/renderdocInvestigation';
import { InvestigationError } from './investigationErrors';
import { hashesEqual, serializeInvestigationJson, sha256Prefixed } from './investigationHash';
import type { InvestigationIndexDocument, InvestigationIndexEntry } from './investigationRecordKeys';
import type { InvestigationTxnMutation } from './investigationTxn';

export interface InvestigationMutationReader {
  readRecordBody<T>(entry: InvestigationIndexEntry): T;
  readJson<T>(uri: string): T;
  parseManifest(value: unknown): InvestigationArtifactManifest;
}

export function upsertIndexEntry(
  index: InvestigationIndexDocument,
  entry: InvestigationIndexEntry,
): InvestigationIndexDocument {
  return {
    schemaVersion: index.schemaVersion,
    artifacts: [...index.artifacts.filter((item) => item.artifactId !== entry.artifactId), entry],
  };
}

export function collectStalePropagation(
  reader: InvestigationMutationReader,
  worldStateId: string,
  index: InvestigationIndexDocument,
): { mutations: InvestigationTxnMutation[]; index: InvestigationIndexDocument } {
  const mutations: InvestigationTxnMutation[] = [];
  let working = index;
  for (const entry of working.artifacts.filter((item) => item.status !== 'superseded')) {
    if (entry.kind === 'evidence') {
      const evidence = reader.readRecordBody<EvidenceRecord>(entry);
      if (evidence.worldStateId !== worldStateId || evidence.stale) continue;
      const rewritten = collectStaleArtifact(reader, entry, { ...evidence, stale: true }, working);
      mutations.push(...rewritten.mutations);
      working = rewritten.index;
      continue;
    }
    if (entry.kind !== 'evidence_pack') continue;
    const pack = reader.readRecordBody<EvidencePack>(entry);
    let changed = false;
    const items = pack.items.map((evidence) => {
      if (evidence.worldStateId !== worldStateId || evidence.stale) return evidence;
      changed = true;
      return { ...evidence, stale: true };
    });
    if (!changed) continue;
    const rewritten = collectStaleArtifact(reader, entry, { items }, working);
    mutations.push(...rewritten.mutations);
    working = rewritten.index;
  }
  return { mutations, index: working };
}

export function collectSupersede(
  reader: InvestigationMutationReader,
  artifactId: string,
  index: InvestigationIndexDocument,
): { mutations: InvestigationTxnMutation[]; index: InvestigationIndexDocument; artifactId: string } {
  const entry = index.artifacts.find((item) => item.artifactId === artifactId);
  if (!entry) {
    throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `supersedes ${artifactId}`);
  }
  const manifest = reader.readJson<InvestigationArtifactManifest>(entry.manifestUri);
  manifest.status = 'superseded';
  return {
    artifactId,
    mutations: [{ uri: entry.manifestUri, text: serializeInvestigationJson(manifest), role: 'supersede' }],
    index: upsertIndexEntry(index, { ...entry, status: 'superseded' }),
  };
}

function collectStaleArtifact(
  reader: InvestigationMutationReader,
  entry: InvestigationIndexEntry,
  record: InvestigationRecord,
  index: InvestigationIndexDocument,
): { mutations: InvestigationTxnMutation[]; index: InvestigationIndexDocument } {
  const contentText = serializeInvestigationJson(record);
  const contentHash = sha256Prefixed(contentText);
  const manifest = reader.parseManifest(reader.readJson<InvestigationArtifactManifest>(entry.manifestUri));
  manifest.contentHash = contentHash;
  manifest.status = 'stale';
  let working = upsertIndexEntry(index, { ...entry, contentHash, status: 'stale' });
  const mutations: InvestigationTxnMutation[] = [
    { uri: entry.contentUri, text: contentText, role: 'stale' },
    { uri: entry.manifestUri, text: serializeInvestigationJson(manifest), role: 'stale' },
  ];
  const dependents = collectReadyDependentsStale(reader, entry.artifactId, working);
  mutations.push(...dependents.mutations);
  working = dependents.index;
  return { mutations, index: working };
}

function collectReadyDependentsStale(
  reader: InvestigationMutationReader,
  sourceArtifactId: string,
  index: InvestigationIndexDocument,
): { mutations: InvestigationTxnMutation[]; index: InvestigationIndexDocument } {
  const mutations: InvestigationTxnMutation[] = [];
  let working = index;
  const currentHash = working.artifacts.find((entry) => entry.artifactId === sourceArtifactId)?.contentHash;
  for (const entry of working.artifacts.filter((item) => item.artifactId !== sourceArtifactId)) {
    if (entry.status !== 'ready') continue;
    const manifest = reader.parseManifest(reader.readJson<InvestigationArtifactManifest>(entry.manifestUri));
    if (manifest.status !== 'ready') continue;
    const drifted = manifest.sourceRefs.some((ref) => (
      ref.artifactId === sourceArtifactId
      && (!currentHash || !hashesEqual(ref.expectedHash, currentHash))
    ));
    if (!drifted) continue;
    manifest.status = 'stale';
    mutations.push({ uri: entry.manifestUri, text: serializeInvestigationJson(manifest), role: 'stale' });
    working = upsertIndexEntry(working, { ...entry, status: 'stale' });
  }
  return { mutations, index: working };
}
