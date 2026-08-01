import type {
  ConversationToolCall,
  ConversationToolExecutionEvidence,
  ConversationWorkBlock,
  ConversationWorkTrace,
} from '@shared/types/conversation';

export function deriveToolExecutionEvidence(
  trace: ConversationWorkTrace | null | undefined,
): ConversationToolExecutionEvidence {
  const calls = collectUniqueToolCalls(trace?.blocks ?? []);
  const evidence: ConversationToolExecutionEvidence = {
    total: calls.length,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };
  for (const call of calls) {
    if (call.status === 'complete') evidence.succeeded += 1;
    else if (call.status === 'error') evidence.failed += 1;
    else evidence.skipped += 1;
  }
  return evidence;
}

export function attachToolExecutionEvidence(
  trace: ConversationWorkTrace,
): ConversationWorkTrace {
  const toolEvidence = deriveToolExecutionEvidence(trace);
  return {
    ...trace,
    toolEvidence,
  };
}

function collectUniqueToolCalls(blocks: readonly ConversationWorkBlock[]): ConversationToolCall[] {
  const calls = new Map<string, ConversationToolCall>();
  const visit = (block: ConversationWorkBlock): void => {
    for (const call of block.toolCalls) {
      calls.set(`${call.toolName}\u0000${call.id}`, call);
    }
    for (const child of block.children ?? []) visit(child);
  };
  for (const block of blocks) visit(block);
  return [...calls.values()];
}
