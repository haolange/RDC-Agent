import * as fs from 'fs';
import {
  INVESTIGATION_SCHEMA_NAMESPACE,
  type ChallengeRecord,
  type ClaimRecord,
  type ClaimSet,
  type EvidencePack,
  type EvidenceRecord,
  type ExperimentRecord,
  type InvestigationArtifactKind,
  type InvestigationArtifactStatus,
  type InvestigationRecord,
  type WorldState,
} from '@shared/types/renderdocInvestigation';
import { formatSessionArtifactUri } from '@shared/types/sessionArtifact';

export const INDEX_URI = formatSessionArtifactUri('investigation', 'index.json');

export interface InvestigationIndexEntry {
  artifactId: string;
  kind: InvestigationArtifactKind;
  recordType: string;
  status: InvestigationArtifactStatus;
  contentUri: string;
  manifestUri: string;
  contentHash: string;
  createdAt: string;
  supersedes?: string;
  recordKey: string;
}

export interface InvestigationIndexDocument {
  schemaVersion: typeof INVESTIGATION_SCHEMA_NAMESPACE;
  artifacts: InvestigationIndexEntry[];
}

type RecordKeySpace =
  | 'world_state'
  | 'evidence'
  | 'claim'
  | 'experiment'
  | 'challenge'
  | 'checkpoint';

export function emptyIndex(): InvestigationIndexDocument {
  return { schemaVersion: INVESTIGATION_SCHEMA_NAMESPACE, artifacts: [] };
}

export function directoryHasJson(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some((name) => name.endsWith('.json'));
}

export function contentUriFor(artifactId: string): string {
  return formatSessionArtifactUri('investigation', `records/${artifactId}.json`);
}

export function manifestUriFor(artifactId: string): string {
  return formatSessionArtifactUri('investigation', `manifests/${artifactId}.json`);
}

export function recordKeyOf(kind: InvestigationArtifactKind, record: InvestigationRecord): string {
  if (kind === 'world_state') return (record as WorldState).worldStateId;
  if (kind === 'evidence') return (record as EvidenceRecord).evidenceId;
  if (kind === 'claim') return (record as ClaimRecord).claimId;
  if (kind === 'experiment') return (record as ExperimentRecord).experimentId;
  if (kind === 'challenge') return (record as ChallengeRecord).challengeId;
  if (kind === 'checkpoint') return (record as { checkpointId: string }).checkpointId;
  return '';
}

export function collectRecordKeys(
  kind: InvestigationArtifactKind,
  record: InvestigationRecord,
): Array<{ space: RecordKeySpace; id: string }> {
  if (kind === 'world_state') return [{ space: 'world_state', id: (record as WorldState).worldStateId }];
  if (kind === 'evidence') return [{ space: 'evidence', id: (record as EvidenceRecord).evidenceId }];
  if (kind === 'evidence_pack') {
    return (record as EvidencePack).items.map((item) => ({ space: 'evidence', id: item.evidenceId }));
  }
  if (kind === 'claim') return [{ space: 'claim', id: (record as ClaimRecord).claimId }];
  if (kind === 'claim_set') {
    return (record as ClaimSet).items.map((item) => ({ space: 'claim', id: item.claimId }));
  }
  if (kind === 'experiment') return [{ space: 'experiment', id: (record as ExperimentRecord).experimentId }];
  if (kind === 'challenge') return [{ space: 'challenge', id: (record as ChallengeRecord).challengeId }];
  if (kind === 'checkpoint') return [{ space: 'checkpoint', id: (record as { checkpointId: string }).checkpointId }];
  if (kind === 'report') {
    // Reports cite claims; they do not own claim ids. Treating cited claimId as a
    // write-key forces supersede of the source Claim and breaks S-CLAIM-01 lookup.
    return [];
  }
  return [];
}

export function recordKeyToken(key: { space: RecordKeySpace; id: string }): string {
  return `${key.space}:${key.id}`;
}

export function collectSupersedeChain(artifacts: InvestigationIndexEntry[], startId?: string): Set<string> {
  const chain = new Set<string>();
  for (let current = startId; current && !chain.has(current); current = artifacts.find((entry) => entry.artifactId === current)?.supersedes) {
    chain.add(current);
  }
  return chain;
}

export function inferWorldStateId(kind: InvestigationArtifactKind, record: InvestigationRecord): string | undefined {
  if (kind === 'world_state') return (record as WorldState).worldStateId;
  if (kind === 'evidence') return (record as EvidenceRecord).worldStateId;
  if (kind === 'claim') return (record as ClaimRecord).worldStateId;
  return undefined;
}

export function isWorldStateBoundKind(kind: InvestigationArtifactKind): boolean {
  return kind === 'world_state' || kind === 'evidence' || kind === 'claim';
}
