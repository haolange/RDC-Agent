import { InvestigationError, toInvestigationError } from './investigationErrors';
import { collectProjectedClaims } from './investigationInvariants';
import { hashesEqual, serializeInvestigationJson, sha256Prefixed } from './investigationHash';
import { parseRecordText, parseRecordTextOf } from './investigationReadIntegrity';
import { collectRecordKeys, recordKeyToken, type InvestigationIndexDocument, type InvestigationIndexEntry } from './investigationRecordKeys';
import type { InvestigationRecordByType } from './investigationRecordSchemas';
import type {
  ChallengeRecord,
  ClaimRecord,
  ClaimSet,
  EvidencePack,
  EvidenceRecord,
  ExperimentRecord,
  InvestigationArtifactKind,
  InvestigationArtifactManifest,
  InvestigationRecord,
  InvestigationRecordType,
  InvestigationReport,
  MissionCheckpoint,
} from '@shared/types/renderdocInvestigation';
import type { InvestigationTxnMutation } from './investigationTxn';

export interface InvestigationMutationReader {
  readRecordBody(entry: InvestigationIndexEntry): InvestigationRecord;
  readRecordBodyOf<Type extends InvestigationRecordType>(entry: InvestigationIndexEntry, recordType: Type): InvestigationRecordByType[Type];
  /** A stored JSON document; the caller validates the shape it expects. */
  readJson(uri: string): unknown;
  parseManifest(value: unknown): InvestigationArtifactManifest;
}

/** Later propagation steps must read the staged body matching their staged index. */
export function withPendingInvestigationMutations(
  reader: InvestigationMutationReader,
  mutations: readonly InvestigationTxnMutation[],
): InvestigationMutationReader {
  const pending = (uri: string) => {
    for (let index = mutations.length - 1; index >= 0; index -= 1) {
      if (mutations[index]!.uri === uri) return mutations[index]!.text;
    }
    return undefined;
  };
  const staged = (entry: InvestigationIndexEntry): string | undefined => {
    const text = pending(entry.contentUri);
    if (text !== undefined && !hashesEqual(entry.contentHash, sha256Prefixed(text))) {
      throw new InvestigationError('INVESTIGATION_HASH_MISMATCH', 'staged record does not match staged index');
    }
    return text;
  };
  return {
    readRecordBody(entry) {
      const text = staged(entry);
      return text === undefined ? reader.readRecordBody(entry) : parseRecordText(entry, text);
    },
    readRecordBodyOf(entry, recordType) {
      const text = staged(entry);
      return text === undefined ? reader.readRecordBodyOf(entry, recordType) : parseRecordTextOf(entry, text, recordType);
    },
    readJson(uri) {
      const text = pending(uri);
      if (text === undefined) return reader.readJson(uri);
      try {
        return JSON.parse(text);
      } catch (error) {
        throw toInvestigationError(error);
      }
    },
    parseManifest: value => reader.parseManifest(value),
  };
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

export function retiredRecordKeysForReplacement(
  reader: InvestigationMutationReader,
  replaced: InvestigationIndexEntry | undefined,
  incomingKind: InvestigationArtifactKind,
  incoming: InvestigationRecord,
): Set<string> {
  if (!replaced) return new Set();
  const incomingIds = new Set(collectRecordKeys(incomingKind, incoming).map(recordKeyToken));
  const retired = new Set(collectRecordKeys(replaced.kind, reader.readRecordBody(replaced))
    .filter(key => (key.space === 'claim' || key.space === 'evidence') && !incomingIds.has(recordKeyToken(key)))
    .map(recordKeyToken));
  if (collectProjectedClaims(incoming).some(claim => [...(claim.supports ?? []), ...(claim.contradicts ?? [])]
    .some(id => retired.has(recordKeyToken({ space: 'claim', id }))))) {
    throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', 'replacement Claim cannot cite a retired Claim ID');
  }
  return retired;
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
      const evidence = reader.readRecordBodyOf(entry, 'EvidenceRecord');
      if (evidence.worldStateId !== worldStateId || evidence.stale) continue;
      const rewritten = collectStaleArtifact(reader, entry, { ...evidence, stale: true }, working);
      mutations.push(...rewritten.mutations);
      working = rewritten.index;
      continue;
    }
    if (entry.kind !== 'evidence_pack') continue;
    const pack = reader.readRecordBodyOf(entry, 'EvidencePack');
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

export function collectSupersededWorldStateDependents(
  reader: InvestigationMutationReader,
  worldStateId: string,
  index: InvestigationIndexDocument,
): { mutations: InvestigationTxnMutation[]; index: InvestigationIndexDocument } {
  const evidence = collectStalePropagation(reader, worldStateId, index);
  const mutations = [...evidence.mutations];
  let working = evidence.index;
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of working.artifacts) {
      if (entry.status !== 'ready' && entry.status !== 'draft') continue;
      const manifest = reader.parseManifest(reader.readJson(entry.manifestUri));
      const boundToRetiredState = entry.kind !== 'world_state' && manifest.worldStateId === worldStateId;
      const citesStaleSource = manifest.sourceRefs.some((ref) => (
        working.artifacts.some((source) => source.artifactId === ref.artifactId && source.status === 'stale')
      ));
      if (!boundToRetiredState && !citesStaleSource) continue;
      manifest.status = 'stale';
      mutations.push({ uri: entry.manifestUri, text: serializeInvestigationJson(manifest), role: 'stale' });
      working = upsertIndexEntry(working, { ...entry, status: 'stale' });
      changed = true;
    }
  }
  return { mutations, index: working };
}

/** Replaced records can retire logical IDs while older records
 * still cite them. Keep those records for audit, but remove them from the live
 * semantic graph in the same transaction (or repair an older transaction). */
export function collectRetiredRecordDependents(
  reader: InvestigationMutationReader,
  retiredRecordKeys: Set<string>,
  index: InvestigationIndexDocument,
): { mutations: InvestigationTxnMutation[]; index: InvestigationIndexDocument } {
  if (retiredRecordKeys.size === 0 && !index.artifacts.some(entry => entry.status === 'stale')) {
    return { mutations: [], index };
  }
  const mutations: InvestigationTxnMutation[] = [];
  // Seed already-invalidated dependencies as well: read repair can encounter a
  // checkpoint left live by an earlier, incomplete supersede transaction.
  const unavailable = new Set([...retiredRecordKeys, ...index.artifacts
    .filter(entry => entry.status === 'stale')
    .flatMap(entry => collectRecordKeys(entry.kind, reader.readRecordBody(entry)).map(recordKeyToken))]);
  let working = index;
  let changed = true;
  const citesRecord = (space: 'claim' | 'evidence' | 'experiment' | 'challenge', id: string | null | undefined): boolean => (
    Boolean(id && unavailable.has(recordKeyToken({ space, id })))
  );
  const citesClaim = (ids: readonly string[] | undefined): boolean => Boolean(ids?.some(id => citesRecord('claim', id)));
  while (changed) {
    changed = false;
    for (const entry of working.artifacts) {
      if (entry.status !== 'ready' && entry.status !== 'draft') continue;
      const record = reader.readRecordBody(entry);
      const citesExperiment = (id: string | null | undefined): boolean => citesRecord('experiment', id);
      let dependent = false;
      switch (entry.kind) {
        case 'experiment': {
          const experiment = record as ExperimentRecord;
          dependent = citesRecord('claim', experiment.hypothesisClaimId)
            || experiment.rollback.verifyEvidenceIds.some(id => citesRecord('evidence', id));
          break;
        }
        case 'challenge': {
          const challenge = record as ChallengeRecord;
          dependent = citesRecord(challenge.targetRef.type, challenge.targetRef.id)
            || citesRecord('claim', challenge.resolutionClaimId);
          break;
        }
        case 'claim': {
          const claim = record as ClaimRecord;
          dependent = citesClaim(claim.supports) || citesClaim(claim.contradicts) || citesExperiment(claim.experimentId);
          break;
        }
        case 'claim_set':
          dependent = (record as ClaimSet).items.some(claim => citesClaim(claim.supports)
            || citesClaim(claim.contradicts) || citesExperiment(claim.experimentId));
          break;
        case 'evidence': {
          const evidence = record as EvidenceRecord;
          dependent = citesClaim(evidence.claimIds) || citesExperiment(evidence.experimentId);
          break;
        }
        case 'evidence_pack':
          dependent = (record as EvidencePack).items.some(evidence => citesClaim(evidence.claimIds)
            || citesExperiment(evidence.experimentId));
          break;
        case 'checkpoint': {
          const checkpoint = record as MissionCheckpoint;
          dependent = citesClaim(checkpoint.established) || citesClaim(checkpoint.rejected)
            || checkpoint.completedExperiments.some(id => citesRecord('experiment', id))
            || checkpoint.openChallenges.some(id => citesRecord('challenge', id));
          break;
        }
        case 'report': {
          const report = record as InvestigationReport;
          dependent = report.claims.some(claim => citesClaim(claim.supports)
            || citesClaim(claim.contradicts) || claim.compactProvenance?.some(source => citesRecord('claim', source.sourceClaimId)))
            || report.experimentIds.some(id => citesRecord('experiment', id))
            || report.evidenceIds.some(id => citesRecord('evidence', id));
          break;
        }
        default:
          break;
      }
      if (!dependent) continue;
      for (const key of collectRecordKeys(entry.kind, record)) unavailable.add(recordKeyToken(key));
      if (entry.kind === 'evidence') {
        const stale = collectStaleArtifact(reader, entry, { ...(record as EvidenceRecord), stale: true }, working);
        mutations.push(...stale.mutations);
        working = stale.index;
      } else if (entry.kind === 'evidence_pack') {
        const pack = record as EvidencePack;
        const stale = collectStaleArtifact(reader, entry, {
          items: pack.items.map(evidence => ({ ...evidence, stale: true })),
        }, working);
        mutations.push(...stale.mutations);
        working = stale.index;
      } else {
        const manifest = reader.parseManifest(reader.readJson(entry.manifestUri));
        manifest.status = 'stale';
        mutations.push({ uri: entry.manifestUri, text: serializeInvestigationJson(manifest), role: 'stale' });
        working = upsertIndexEntry(working, { ...entry, status: 'stale' });
      }
      changed = true;
    }
  }
  return { mutations, index: working };
}

export function collectSupersede(
  reader: InvestigationMutationReader,
  artifactId: string,
  index: InvestigationIndexDocument,
  retiredRecordKeys: Set<string> = new Set(),
): { mutations: InvestigationTxnMutation[]; index: InvestigationIndexDocument; artifactId: string } {
  const entry = index.artifacts.find((item) => item.artifactId === artifactId);
  if (!entry) {
    throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `supersedes ${artifactId}`);
  }
  const manifest = reader.parseManifest(reader.readJson(entry.manifestUri));
  manifest.status = 'superseded';
  const stale = collectRetiredRecordDependents(reader, retiredRecordKeys,
    upsertIndexEntry(index, { ...entry, status: 'superseded' }));
  return {
    artifactId,
    mutations: [{ uri: entry.manifestUri, text: serializeInvestigationJson(manifest), role: 'supersede' }, ...stale.mutations],
    index: stale.index,
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
  const manifest = reader.parseManifest(reader.readJson(entry.manifestUri));
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
    const manifest = reader.parseManifest(reader.readJson(entry.manifestUri));
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
