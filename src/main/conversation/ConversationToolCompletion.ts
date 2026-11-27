import { z } from 'zod';
import { buildToolResultPreview } from '@shared/utils/toolResultPreview';
import { redactCredentialLikeText } from '../runtime/secretRedaction';
import { normalizeToolName } from '../agent-runtime/orchestration/RuntimeToolPolicy';
import { extractConversationToolResourceRefs, extractToolImagePreviews } from './ConversationToolResourceRefs';
import type { ToolCallResult } from '@shared/types/tool';
import type { ConversationRuntimeRecovery, ConversationToolCall } from '@shared/types/conversation';

/** The host's recovery outcome riding on a tool result; anything else there is not projected. */
const RuntimeRecoverySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('rebuilt') }).transform(() => ({ status: 'rebuilt' as const })),
  z
    .object({
      status: z.literal('blocked'),
      code: z.string().min(1),
      exit: z.enum(['agent-recover', 'ask-user', 'restart']),
    })
    .transform(({ status, code, exit }) => ({ status, code, exit })),
]);

function runtimeRecoveryOf(result: ToolCallResult | undefined): { runtimeRecovery?: ConversationRuntimeRecovery } {
  const details = result?.ok ? result.data?.details : result?.error?.details;
  if (!details || typeof details !== 'object' || !('runtimeRecovery' in details)) return {};
  const parsed = RuntimeRecoverySchema.safeParse(details.runtimeRecovery);
  return parsed.success ? { runtimeRecovery: parsed.data } : {};
}

/** Shared projection for streamed and stopped-turn canonical tool completions. */
export function buildConversationToolCompletion(
  id: string,
  toolName: string,
  result: ToolCallResult | undefined,
  existing: ConversationToolCall | undefined,
  completedAt: number,
): Partial<ConversationToolCall> & { id: string; toolName: string } {
  const normalized = normalizeToolName(toolName);
  const cancelled = !result?.ok && (existing?.status === 'cancelled' || result?.error?.details?.reason === 'abort');
  const skipped = result?.error?.details?.reason === 'turn completed after tool';
  const patch: Partial<ConversationToolCall> & { id: string; toolName: string } = {
    id,
    toolName,
    status: skipped ? 'skipped' : cancelled ? 'cancelled' : result?.ok ? 'complete' : 'error',
    error: skipped || cancelled || result?.ok ? undefined : result?.error?.message,
    completedAt: cancelled ? (existing?.completedAt ?? completedAt) : completedAt,
    ...runtimeRecoveryOf(result),
  };
  if (normalized === 'subagent') {
    const details = (result?.data?.details ?? result?.error?.details) as Record<string, unknown> | undefined;
    patch.delegation = {
      task: existing?.delegation?.task ?? '',
      profile:
        typeof details?.profile === 'string' && details.profile
          ? details.profile
          : (existing?.delegation?.profile ?? ''),
      mode: existing?.delegation?.mode ?? 'wait',
      executionId: typeof details?.executionId === 'string' ? details.executionId : existing?.delegation?.executionId,
      generation: typeof details?.generation === 'number' ? details.generation : existing?.delegation?.generation,
    };
  }
  const resourceRefs = extractConversationToolResourceRefs(toolName, result);
  if (resourceRefs.length) patch.resourceRefs = resourceRefs;
  const imagePreviews = extractToolImagePreviews(result);
  if (imagePreviews.length) patch.imagePreviews = imagePreviews;
  if (!((normalized === 'ask_user' || normalized === 'plan_artifact') && result?.ok)) {
    const preview = buildToolResultPreview(result ?? {});
    patch.resultPreview = patch.delegation ? redactCredentialLikeText(preview) : preview;
  }
  return patch;
}
