import { isMissionAgentId } from '@shared/types/agent';
import type { HandoffContract } from '@shared/types/handoffContract';
import type { TaskCompletionBinding } from '../agent-runtime/agent/TurnCompletionValidator';
import { investigationArtifactService } from './InvestigationArtifactService';

export interface InvestigationHandoffValidation {
  sessionId: string;
  sourceAgentId: string;
  targetAgentId: string;
  contract: HandoffContract;
  taskBinding?: Readonly<TaskCompletionBinding> | null;
}

/** Validate domain route and checkpoint before the handoff can terminate the executing turn. */
export function validateInvestigationHandoff(input: InvestigationHandoffValidation): void {
  if (isMissionAgentId(input.sourceAgentId) && input.targetAgentId === 'general' && input.contract.intent !== 'execute') {
    throw new Error('HANDOFF_STATE_CONFLICT: a planning agent must dispatch a bound execution.');
  }
  const binding = input.taskBinding;
  if (!binding) return;
  if (input.targetAgentId !== binding.returnTo || input.contract.intent !== 'return' || input.contract.executionHandoffId !== binding.handoffId) {
    throw new Error('HANDOFF_STATE_CONFLICT: return must match the frozen execution binding.');
  }
  if (binding.validationPolicy !== 'renderdoc-investigation') return;
  const refs = input.contract.artifacts;
  const checkpoint = investigationArtifactService.list(input.sessionId, { kind: 'checkpoint' }).some(entry => {
    const read = investigationArtifactService.readRecord(input.sessionId, entry.artifactId);
    return read.manifest.mission === binding.returnTo
      && Date.parse(read.manifest.createdAt) >= binding.dispatchedAt
      && refs.some(ref => ref.uri === read.contentUri && ref.hash.replace(/^sha256:/, '') === read.contentHash.replace(/^sha256:/, ''));
  });
  if (!checkpoint) throw new Error('HANDOFF_CHECKPOINT_REQUIRED: return requires a checkpoint updated during this execution.');
}
