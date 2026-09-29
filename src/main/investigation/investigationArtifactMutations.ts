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
  InvestigationReport,
  MissionCheckpoint,
} from '@shared/types/renderdocInvestigation';
import { InvestigationError } from './investigationErrors';
import { collectProjectedClaims } from './investigationInvariants';
import { hashesEqual, serializeInvestigationJson, sha256Prefixed } from './investigationHash';
import { collectRecordKeys, type InvestigationIndexDocument, type InvestigationIndexEntry } from './investigationRecordKeys';
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

export function retiredClaimIdsForReplacement(
  reader: InvestigationMutationReader,
  replaced: InvestigationIndexEntry | undefined,
  incomingKind: InvestigationArtifactKind,
  incoming: InvestigationRecord,
): Set<string> {
  if (!replaced) return new Set();
  const incomingIds = new Set(collectRecordKeys(incomingKind, incoming)
    .filter(key => key.space === 'claim').map(key => key.id));
  const retired = new Set(collectRecordKeys(replaced.kind, reader.readRecordBody<InvestigationRecord>(replaced))
    .filter(key => key.space === 'claim' && !incomingIds.has(key.id)).map(key => key.id));
  if (collectProjectedClaims(incoming).some(claim => [...(claim.supports ?? []), ...(claim.contradicts ?? [])]
    .some(id => retired.has(id)))) {
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
      const manifest = reader.parseManifest(reader.readJson<InvestigationArtifactManifest>(entry.manifestUri));
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

/** A replaced Claim/ClaimSet can retire logical claim IDs while older records
 * still cite them. Keep those records for audit, but remove them from the live
 * semantic graph in the same transaction (or repair an older transaction). */
export function collectRetiredClaimDependents(
  reader: InvestigationMutationReader,
  retiredClaimIds: Set<string>,
  index: InvestigationIndexDocument,
): { mutations: InvestigationTxnMutation[]; index: InvestigationIndexDocument } {
  if (retiredClaimIds.size === 0) return { mutations: [], index };
  const mutations: InvestigationTxnMutation[] = [];
  const staleExperimentIds = new Set<string>();
  let working = index;
  let changed = true;
  const citesClaim = (ids: readonly string[] | undefined): boolean => Boolean(ids?.some(id => retiredClaimIds.has(id)));
  while (changed) {
    changed = false;
    for (const entry of working.artifacts) {
      if (entry.status !== 'ready' && entry.status !== 'draft') continue;
      const record = reader.readRecordBody<InvestigationRecord>(entry);
      const citesExperiment = (id: string | null | undefined): boolean => Boolean(id && staleExperimentIds.has(id));
      let dependent = false;
      switch (entry.kind) {
        case 'experiment':
          dependent = retiredClaimIds.has((record as ExperimentRecord).hypothesisClaimId);
          break;
        case 'challenge': {
          const challenge = record as ChallengeRecord;
          dependent = (challenge.targetRef.type === 'claim' && retiredClaimIds.has(challenge.targetRef.id))
            || (challenge.targetRef.type === 'experiment' && citesExperiment(challenge.targetRef.id))
            || retiredClaimIds.has(challenge.resolutionClaimId ?? '');
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
            || checkpoint.completedExperiments.some(id => staleExperimentIds.has(id));
          break;
        }
        case 'report': {
          const report = record as InvestigationReport;
          dependent = report.claims.some(claim => citesClaim(claim.supports)
            || citesClaim(claim.contradicts) || claim.compactProvenance?.some(source => retiredClaimIds.has(source.sourceClaimId)))
            || report.experimentIds.some(id => staleExperimentIds.has(id));
          break;
        }
        default:
          break;
      }
      if (!dependent) continue;
      if (entry.kind === 'experiment') staleExperimentIds.add((record as ExperimentRecord).experimentId);
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
        const manifest = reader.parseManifest(reader.readJson<InvestigationArtifactManifest>(entry.manifestUri));
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
  retiredClaimIds: Set<string> = new Set(),
): { mutations: InvestigationTxnMutation[]; index: InvestigationIndexDocument; artifactId: string } {
  const entry = index.artifacts.find((item) => item.artifactId === artifactId);
  if (!entry) {
    throw new InvestigationError('INVESTIGATION_REF_UNRESOLVED', `supersedes ${artifactId}`);
  }
  const manifest = reader.readJson<InvestigationArtifactManifest>(entry.manifestUri);
  manifest.status = 'superseded';
  const stale = collectRetiredClaimDependents(reader, retiredClaimIds,
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
