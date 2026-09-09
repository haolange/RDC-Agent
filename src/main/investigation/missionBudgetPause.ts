import { HANDOFF_EXECUTION_CYCLE_LIMIT } from '@shared/types/profileHandoff';
import type { MissionCheckpoint } from '@shared/types/renderdocInvestigation';
import type { TurnCompletionInput } from '../agent-runtime/agent/TurnCompletionValidator';
import { storageAdapter } from '../sessions/StorageAdapter';
import type { InvestigationArtifactService } from './InvestigationArtifactService';

/** Ends only the current turn; no report is promoted and no domain completion is asserted. */
export function allowsBudgetPause(input: TurnCompletionInput, service: InvestigationArtifactService): boolean {
  if (!input.sessionId || !input.turnId || !input.finalAnswerText.startsWith('[INCOMPLETE]')) return false;
  const history = storageAdapter.handoffs.readDocument(input.sessionId)?.history ?? [];
  const last = history.filter(entry => entry.lifecycle === 'consumed').at(-1);
  if (!last || last.toAgentId !== input.profileId || last.continuationTurnId !== input.turnId || last.contract.intent !== 'return') return false;
  const cycles = history.filter(entry => entry.chainRoot === last.chainRoot && entry.lifecycle === 'consumed' && entry.contract.intent === 'execute');
  if (new Set(cycles.map(entry => entry.handoffId)).size !== HANDOFF_EXECUTION_CYCLE_LIMIT) return false;
  const refs = last.contract.artifacts;
  return service.list(input.sessionId, { kind: 'checkpoint' }).some(entry => {
    const checkpoint = service.readRecord(input.sessionId!, entry.artifactId);
    const record = checkpoint.record as MissionCheckpoint;
    return checkpoint.manifest.mission === input.profileId && !!record.unresolvedFrontier.trim()
      && refs.some(ref => ref.uri === checkpoint.contentUri && ref.hash.replace(/^sha256:/, '') === checkpoint.contentHash.replace(/^sha256:/, ''))
      && input.finalAnswerText.includes(checkpoint.contentUri) && input.finalAnswerText.includes(checkpoint.contentHash)
      && input.finalAnswerText.includes(record.unresolvedFrontier);
  });
}
