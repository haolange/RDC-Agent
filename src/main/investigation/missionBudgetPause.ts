import type { MissionCheckpoint } from '@shared/types/renderdocInvestigation';
import type { TurnCompletionInput } from '../agent-runtime/agent/TurnCompletionValidator';
import type { InvestigationArtifactService } from './InvestigationArtifactService';

/** Ends only the current turn; no report is promoted and no domain completion is asserted. */
export function allowsBudgetPause(input: TurnCompletionInput, service: InvestigationArtifactService): boolean {
  const budget = input.budgetEvidence;
  const proved = budget?.kind === 'provider-turns'
    ? Number.isFinite(budget.limit) && budget.remaining >= 1 && budget.remaining <= 5 && budget.remaining <= budget.limit
    : budget?.kind === 'tool-calls' && budget.limit < Number.MAX_SAFE_INTEGER && budget.consumed >= budget.limit;
  if (!input.sessionId || input.disposition !== 'budget_paused' || !proved) return false;
  return service.list(input.sessionId, { kind: 'checkpoint' }).some((entry) => {
    if (entry.status !== 'ready' && entry.status !== 'draft') return false;
    const checkpoint = service.readRecord(input.sessionId!, entry.artifactId);
    const record = checkpoint.record as MissionCheckpoint;
    return checkpoint.manifest.mission === (input.investigationMission ?? input.profileId) && !!record.unresolvedFrontier.trim()
      && (input.evidenceRefs ?? []).some(ref => ref.uri === checkpoint.contentUri
        && ref.hash.replace(/^sha256:/, '') === checkpoint.contentHash.replace(/^sha256:/, ''));
  });
}
