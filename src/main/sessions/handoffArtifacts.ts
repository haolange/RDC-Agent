import { HandoffContractSchema, type HandoffContract } from '@shared/types/handoffContract';
import { sessionArtifactResolver } from './SessionArtifactResolver';

export function validateHandoffArtifacts(sessionId: string, input: unknown): HandoffContract {
  const contract = HandoffContractSchema.parse(input);
  const refs = contract.intent === 'execute' ? [contract.plan] : contract.intent === 'return' ? contract.artifacts : [];
  for (const ref of refs) {
    const artifact = sessionArtifactResolver.read(sessionId, ref.uri, { expectedHash: ref.hash.replace(/^sha256:/, '') });
    if (contract.intent === 'execute' && (artifact.category !== 'plans' || artifact.mimeType !== 'text/markdown')) {
      throw new Error('HANDOFF_PLAN_INVALID: execution requires a Markdown plans artifact.');
    }
  }
  return contract;
}
