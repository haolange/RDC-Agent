import type { MissionCheckpoint } from '@shared/types/renderdocInvestigation';
import type { TurnCompletionInput } from '../agent-runtime/agent/TurnCompletionValidator';
import type { InvestigationArtifactService } from './InvestigationArtifactService';

/** Ends only the current turn; no report is promoted and no domain completion is asserted. */
export function allowsBudgetPause(input: TurnCompletionInput, service: InvestigationArtifactService): boolean {
  if (!input.sessionId || input.disposition !== 'budget_paused') return false;
  return service.list(input.sessionId, { kind: 'checkpoint' }).some((entry) => {
    const checkpoint = service.readRecord(input.sessionId!, entry.artifactId);
    const record = checkpoint.record as MissionCheckpoint;
    return checkpoint.manifest.mission === input.profileId && !!record.unresolvedFrontier.trim();
  });
}
