import { assistantMessageText, executeCompactionHandoff, type CompactionHandoffExecution } from './CompactionHandoffRuntime';
import { parseModelHandoffSections } from './StructuredHandoffBuilder';
import { ContextManager } from '../agent/ContextManager';

/** Frozen route, credentials and cancellation are owned by the calling execution. */
export async function generateCompactionSections(input: CompactionHandoffExecution) {
  input.signal?.throwIfAborted();
  const estimator = new ContextManager({ contextTokenLimit: input.plan.contextWindowTokens });
  if (estimator.estimateTokens([{ role: 'user', content: input.transcript, timestamp: 0 }]) + 8192 > input.plan.contextWindowTokens) {
    throw new Error('COMPACTION_SOURCE_TOO_LARGE: original evidence exceeds the safe compaction budget.');
  }
  const message = await executeCompactionHandoff(input);
  return { ...parseModelHandoffSections(assistantMessageText(message)), usage: message.usage };
}
