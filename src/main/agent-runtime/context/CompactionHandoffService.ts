import { AppError } from '@shared/errors/appError';
import { assistantMessageText } from '../prompt/AuxiliaryRequest';
import { ContextManager } from '../agent/ContextManager';
import { executeCompactionHandoff, type CompactionHandoffExecution } from './CompactionHandoffRuntime';
import { parseModelHandoffSections } from './StructuredHandoffBuilder';

/** Frozen route, credentials and cancellation are owned by the calling execution. */
export async function generateCompactionSections(input: CompactionHandoffExecution) {
  input.signal?.throwIfAborted();
  const estimator = new ContextManager({ contextTokenLimit: input.plan.contextWindowTokens });
  if (estimator.estimateTokens([{ role: 'user', content: input.transcript, timestamp: 0 }]) + 8192 > input.plan.contextWindowTokens) {
    throw new AppError('COMPACTION_SOURCE_TOO_LARGE', 'original evidence exceeds the safe compaction budget.');
  }
  const message = await executeCompactionHandoff(input);
  return { ...parseModelHandoffSections(assistantMessageText(message)), usage: message.usage };
}
