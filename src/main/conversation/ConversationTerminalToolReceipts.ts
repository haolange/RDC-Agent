import type { ConversationWorkTrace } from '@shared/types/conversation';
import { toolResultToSharedResult } from '../agent-runtime/AgentEventBridge';
import type { Message } from '../agent-runtime/core/types';
import { buildConversationToolCompletion } from './ConversationToolCompletion';
import { upsertRuntimeToolCall } from './ConversationWorkTrace';

/** Complete only existing tool rows from the owning turn's canonical terminal context. */
export function reconcileTerminalToolReceipts(
  trace: ConversationWorkTrace | null | undefined,
  messages: Message[],
  turnStartedAt: number,
): ConversationWorkTrace | null | undefined {
  if (!Number.isFinite(turnStartedAt)) return trace;
  let next = trace;
  for (const message of messages) {
    if (message.role !== 'toolResult' || !Number.isFinite(message.timestamp) || message.timestamp < turnStartedAt) continue;
    const call = next?.blocks.flatMap((block) => block.toolCalls).find((entry) => entry.id === message.toolCallId);
    if (!call || call.toolName !== message.toolName || !Number.isFinite(call.startedAt)
      || call.startedAt < turnStartedAt || message.timestamp < call.startedAt
      || (call.status !== 'pending' && call.status !== 'running')) continue;
    const result = toolResultToSharedResult(message, message.timestamp - call.startedAt);
    const patch = buildConversationToolCompletion(call.id, call.toolName, result, call, message.timestamp);
    next = upsertRuntimeToolCall(next, patch);
  }
  return next;
}
