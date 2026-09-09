import { storageAdapter } from './StorageAdapter';
import type { PromptSegment } from '@shared/types/rdxRuntime';
import { hashScopedResource } from '../runtime/ScopedResourceResolver';
import { charsToTokens } from '@shared/utils/tokens';

export function handoffPromptSegments(sessionId: string | null | undefined, agentId: string): PromptSegment[] {
  if (!sessionId) return [];
  const handoff = storageAdapter.handoffs.getActive(sessionId);
  if (!handoff || handoff.lifecycle !== 'committed' || handoff.toAgentId !== agentId) return [];
  const content = '# Current Task Binding\n\n' + JSON.stringify({
    handoffId: handoff.handoffId, from: handoff.sourceAgentId, contract: handoff.contract,
  });
  return [{ id: 'task:handoff', kind: 'runtime-fact', scope: 'runtime', sourcePath: 'runtime://task/handoff',
    sourceHash: hashScopedResource(content), content, precedence: 0, stability: 'volatile', tokenEstimate: charsToTokens(content.length) }];
}
