import type { ConversationToolCall } from '@shared/types/conversation';
import type { ToolCallResult } from '@shared/types/tool';
import { buildToolResultPreview } from '@shared/utils/toolResultPreview';
import { redactCredentialLikeText } from '../runtime/secretRedaction';
import { normalizeToolName } from '../workflow/debugger/DebuggerRuntimePolicy';
import { extractConversationToolResourceRefs, extractToolImagePreviews } from './ConversationToolResourceRefs';

/** Shared projection for streamed and stopped-turn canonical tool completions. */
export function buildConversationToolCompletion(
  id: string, toolName: string, result: ToolCallResult | undefined,
  existing: ConversationToolCall | undefined, completedAt: number,
): Partial<ConversationToolCall> & { id: string; toolName: string } {
  const normalized = normalizeToolName(toolName);
  const cancelled = !result?.ok && (existing?.status === 'cancelled'
    || result?.error?.details?.reason === 'abort');
  const skipped = result?.error?.details?.reason === 'turn completed after tool';
  const patch: Partial<ConversationToolCall> & { id: string; toolName: string } = {
    id, toolName, status: skipped ? 'skipped' : cancelled ? 'cancelled' : result?.ok ? 'complete' : 'error',
    error: skipped || cancelled || result?.ok ? undefined : result?.error?.message,
    completedAt: cancelled ? existing?.completedAt ?? completedAt : completedAt,
  };
  if (normalized === 'subagent') {
    const details = (result?.data?.details ?? result?.error?.details) as Record<string, unknown> | undefined;
    patch.delegation = {
      task: existing?.delegation?.task ?? '',
      profile: existing?.delegation?.profile ?? String(details?.profile ?? 'general'),
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
