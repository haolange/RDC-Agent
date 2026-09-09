import { storageAdapter } from './StorageAdapter';
import { validateHandoffArtifacts } from './handoffArtifacts';

/** Only a committed handoff to this recipient can preload task-bound methods. */
export function handoffRequiredSkillIds(sessionId: string | null | undefined, agentId: string): string[] {
  if (!sessionId) return [];
  const handoff = storageAdapter.handoffs.getActive(sessionId);
  if (!handoff || handoff.lifecycle !== 'committed' || handoff.toAgentId !== agentId) return [];
  const contract = validateHandoffArtifacts(sessionId, handoff.contract);
  return contract.intent === 'execute' ? [...new Set(contract.requiredSkillIds)] : [];
}
