import { isMissionAgentId } from '@shared/types/agent';
import type { TaskCompletionBinding } from '../agent-runtime/agent/TurnCompletionValidator';
import { storageAdapter } from '../sessions/StorageAdapter';

/** Domain policy is chosen by main from the actual dispatcher, never from model input. */
export function resolveInvestigationTaskBinding(sessionId: string | null, recipient: string): TaskCompletionBinding | null {
  if (!sessionId) return null;
  const handoff = storageAdapter.handoffs.getActive(sessionId);
  if (!handoff || handoff.lifecycle !== 'committed' || handoff.toAgentId !== recipient || handoff.contract.intent !== 'execute') return null;
  return Object.freeze({
    handoffId: handoff.handoffId, dispatchedAt: handoff.preparedAt, returnTo: handoff.sourceAgentId,
    deliveryRequirements: handoff.contract.deliveryRequirements,
    validationPolicy: isMissionAgentId(handoff.sourceAgentId) ? 'renderdoc-investigation' : 'task-return',
  });
}
