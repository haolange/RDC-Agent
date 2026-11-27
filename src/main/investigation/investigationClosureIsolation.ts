import { evaluateSRdc01 } from './investigationInvariants';
import { serializeInvestigationJson, sha256Prefixed } from './investigationHash';
import { assertReadySourcesUnchanged } from './investigationReadIntegrity';
import { contentUriFor, manifestUriFor, recordKeyOf } from './investigationRecordKeys';
import { collectSupersede, upsertIndexEntry, type InvestigationMutationReader } from './investigationArtifactMutations';
import type { InvestigationIndexDocument, InvestigationIndexEntry } from './investigationRecordKeys';
import type { InvestigationTxnMutation } from './investigationTxn';
import type { InvestigationLookup } from './investigationInvariants';
import type {
  ArtifactSourceRef,
  EvidenceRecord,
  ExperimentRecord,
  InvestigationArtifactStatus,
  InvestigationRecord,
} from '@shared/types/renderdocInvestigation';

interface ClosureState {
  mutations: InvestigationTxnMutation[];
  index: InvestigationIndexDocument;
}

/**
 * S-RDC-01 judged again when an experiment closes. A mutated WorldState written before its experiment existed was
 * judged polluted; once the experiment is recorded or rolled back with verified execution evidence, the same rule
 * decides again. Where isolation now holds, the WorldState and the Evidence that went stale with it get new versions
 * that supersede the old ones in the experiment's own transaction. History is not rewritten; a WorldState without an
 * exclusive lock or a verified rollback stays polluted.
 */
export function collectClosureIsolation(input: {
  experiment: ExperimentRecord;
  lookup: InvestigationLookup;
  reader: InvestigationMutationReader;
  index: InvestigationIndexDocument;
  artifactId: () => string;
  now: string;
}): ClosureState {
  let state: ClosureState = { mutations: [], index: input.index };
  if (input.experiment.status !== 'recorded' && input.experiment.status !== 'rolled_back') return state;
  const { baselineWorldStateId, variantWorldStateId, restoredWorldStateId } = input.experiment;
  for (const worldStateId of new Set([baselineWorldStateId, variantWorldStateId, restoredWorldStateId])) {
    const entry = state.index.artifacts.find(
      (item) =>
        item.kind === 'world_state' &&
        item.recordKey === worldStateId &&
        (item.status === 'ready' || item.status === 'draft'),
    );
    if (!entry) continue;
    const worldState = input.reader.readRecordBodyOf(entry, 'WorldState');
    if (
      worldState.validity !== 'polluted' ||
      evaluateSRdc01({ worldState, experiment: input.experiment, lookup: input.lookup }).polluted
    )
      continue;
    const restated = stageVersion(input, state, entry, { ...worldState, validity: 'valid' }, entry.status, []);
    state = restated.state;
    const remap = { from: entry.artifactId, to: { artifactId: restated.artifactId, expectedHash: restated.hash } };
    state = restateEvidence(input, state, worldStateId, remap);
  }
  return state;
}

function restateEvidence(
  input: Parameters<typeof collectClosureIsolation>[0],
  initial: ClosureState,
  worldStateId: string,
  remap: { from: string; to: ArtifactSourceRef },
): ClosureState {
  let state = initial;
  const restore = (evidence: EvidenceRecord): EvidenceRecord =>
    evidence.worldStateId === worldStateId && evidence.stale ? { ...evidence, stale: false } : evidence;
  for (const entry of state.index.artifacts.filter((item) => item.status !== 'superseded')) {
    let record: InvestigationRecord | null = null;
    if (entry.kind === 'evidence') {
      const evidence = input.reader.readRecordBodyOf(entry, 'EvidenceRecord');
      if (restore(evidence) !== evidence) record = restore(evidence);
    } else if (entry.kind === 'evidence_pack') {
      const pack = input.reader.readRecordBodyOf(entry, 'EvidencePack');
      const items = pack.items.map(restore);
      if (items.some((item, position) => item !== pack.items[position])) record = { items };
    }
    if (!record) continue;
    // Evidence the pollution itself turned stale had its authored status overwritten; its new version starts as draft.
    const status = entry.status === 'ready' || entry.status === 'draft' ? entry.status : 'draft';
    state = stageVersion(input, state, entry, record, status, [remap]).state;
  }
  return state;
}

function stageVersion(
  input: Parameters<typeof collectClosureIsolation>[0],
  initial: ClosureState,
  entry: InvestigationIndexEntry,
  record: InvestigationRecord,
  status: InvestigationArtifactStatus,
  remaps: { from: string; to: ArtifactSourceRef }[],
): { state: ClosureState; artifactId: string; hash: string } {
  const previous = input.reader.parseManifest(input.reader.readJson(entry.manifestUri));
  const superseded = collectSupersede(input.reader, entry.artifactId, initial.index);
  const artifactId = input.artifactId();
  const contentText = serializeInvestigationJson(record);
  const hash = sha256Prefixed(contentText);
  const sourceRefs = previous.sourceRefs.map((ref) => remaps.find((remap) => remap.from === ref.artifactId)?.to ?? ref);
  const manifest = {
    ...previous,
    artifactId,
    status,
    contentRef: contentUriFor(artifactId),
    contentHash: hash,
    sourceRefs,
    supersedes: entry.artifactId,
    createdAt: input.now,
  };
  input.reader.parseManifest(manifest);
  const index = upsertIndexEntry(superseded.index, {
    artifactId,
    kind: entry.kind,
    recordType: entry.recordType,
    status,
    contentUri: manifest.contentRef,
    manifestUri: manifestUriFor(artifactId),
    contentHash: hash,
    createdAt: input.now,
    supersedes: entry.artifactId,
    recordKey: recordKeyOf(entry.kind, record),
  });
  if (status === 'ready') assertReadySourcesUnchanged(sourceRefs, index);
  return {
    artifactId,
    hash,
    state: {
      mutations: [
        ...initial.mutations,
        ...superseded.mutations,
        { uri: manifest.contentRef, text: contentText, role: 'content' },
        { uri: manifestUriFor(artifactId), text: serializeInvestigationJson(manifest), role: 'manifest' },
      ],
      index,
    },
  };
}
