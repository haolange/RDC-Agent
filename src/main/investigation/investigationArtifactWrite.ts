import type {
  ArtifactSourceRef,
  InvestigationArtifactKind,
  InvestigationArtifactManifest,
  InvestigationMission,
  InvestigationRecord,
  InvestigationReport,
  WorldState,
} from '@shared/types/renderdocInvestigation';
import type { SessionArtifactResolver } from '../sessions/SessionArtifactResolver';
import { InvestigationError } from './investigationErrors';
import type { InvestigationLookup } from './investigationInvariants';
import { assertNoOpaqueProviderPayload } from './investigationRecordSchemas';

export interface InvestigationWriteInput {
  kind: string;
  mission: InvestigationMission;
  title: string;
  summary: string;
  record: unknown;
  sourceRefs?: ArtifactSourceRef[];
  worldStateId?: string;
  supersedes?: string;
  status?: 'draft' | 'ready';
  artifactId?: string;
  createdAt?: string;
}

export interface InvestigationWriteResult {
  manifest: InvestigationArtifactManifest;
  contentUri: string;
  contentHash: string;
  record: InvestigationRecord;
  supersededArtifactId?: string;
}

export interface InvestigationReadResult {
  manifest: InvestigationArtifactManifest;
  record: InvestigationRecord;
  contentUri: string;
  contentHash: string;
}

export interface InvestigationArtifactServiceDeps {
  resolver?: SessionArtifactResolver;
  now?: () => Date;
}

export function requireCanonicalWriteMission(
  kind: InvestigationArtifactKind,
  inputMission: InvestigationMission,
  record: InvestigationRecord,
): InvestigationMission {
  if (kind !== 'report') return inputMission;
  const reportMission = (record as InvestigationReport).mission;
  if (reportMission !== inputMission) {
    throw new InvestigationError(
      'INVESTIGATION_INVARIANT_VIOLATION',
      `input.mission ${inputMission} does not match report.mission ${reportMission}`,
      { details: { inputMission, reportMission } },
    );
  }
  return reportMission;
}

export function rejectOpaqueWriteInput(input: InvestigationWriteInput): void {
  try {
    assertNoOpaqueProviderPayload(input);
    assertNoOpaqueProviderPayload(input.record);
  } catch (error) {
    throw new InvestigationError(
      'INVESTIGATION_OPAQUE_PAYLOAD_DENIED',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function worldStateBindError(ready: boolean, message: string): InvestigationError {
  return new InvestigationError(ready ? 'INVESTIGATION_READY_DENIED' : 'INVESTIGATION_REF_UNRESOLVED', message);
}

export function worldStateResolvable(
  kind: InvestigationArtifactKind,
  record: InvestigationRecord,
  worldStateId: string,
  lookup: InvestigationLookup,
): boolean {
  if (kind === 'world_state' && (record as WorldState).worldStateId === worldStateId) return true;
  return lookup.getWorldState(worldStateId) != null;
}
