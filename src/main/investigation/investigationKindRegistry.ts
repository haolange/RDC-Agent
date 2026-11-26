import { type InvestigationArtifactKind } from '@shared/types/renderdocInvestigation';
import { InvestigationError } from './investigationErrors';
import type { InvestigationRecordType } from '@shared/types/renderdocInvestigation';

export const INVESTIGATION_NAMESPACE = 'rdc.investigation' as const;

export interface InvestigationKindRegistryEntry {
  kind: InvestigationArtifactKind;
  recordType: InvestigationRecordType;
  schema: `${typeof INVESTIGATION_NAMESPACE}.${InvestigationRecordType}`;
}

export const INVESTIGATION_KIND_REGISTRY: readonly InvestigationKindRegistryEntry[] = [
  { kind: 'world_state', recordType: 'WorldState', schema: 'rdc.investigation.WorldState' },
  { kind: 'evidence', recordType: 'EvidenceRecord', schema: 'rdc.investigation.EvidenceRecord' },
  { kind: 'evidence_pack', recordType: 'EvidencePack', schema: 'rdc.investigation.EvidencePack' },
  { kind: 'claim', recordType: 'ClaimRecord', schema: 'rdc.investigation.ClaimRecord' },
  { kind: 'claim_set', recordType: 'ClaimSet', schema: 'rdc.investigation.ClaimSet' },
  { kind: 'experiment', recordType: 'ExperimentRecord', schema: 'rdc.investigation.ExperimentRecord' },
  { kind: 'challenge', recordType: 'ChallengeRecord', schema: 'rdc.investigation.ChallengeRecord' },
  { kind: 'checkpoint', recordType: 'MissionCheckpoint', schema: 'rdc.investigation.MissionCheckpoint' },
  { kind: 'report', recordType: 'InvestigationReport', schema: 'rdc.investigation.InvestigationReport' },
] as const;

const KIND_BY_ID = new Map<string, InvestigationKindRegistryEntry>(
  INVESTIGATION_KIND_REGISTRY.map((entry) => [entry.kind, entry]),
);

export function requireInvestigationKind(kind: string): InvestigationKindRegistryEntry {
  const resolved = resolveInvestigationKind(kind);
  if (!resolved) {
    throw new InvestigationError('INVESTIGATION_KIND_UNKNOWN', `unregistered kind "${kind}"`);
  }
  return resolved;
}

export function isInvestigationArtifactKind(value: string): value is InvestigationArtifactKind {
  return resolveInvestigationKind(value) != null;
}

export function resolveInvestigationKind(kind: string): InvestigationKindRegistryEntry | null {
  return KIND_BY_ID.get(kind) ?? null;
}
