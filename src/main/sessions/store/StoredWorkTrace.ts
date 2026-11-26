import type {
  ConversationLoopItem,
  ConversationToolCall,
  ConversationWorkBlock,
  ConversationWorkTrace,
} from '@shared/types/conversation';
import type { ProviderOutputRef, ThinkingArtifactKind } from '@shared/types/reasoning';

/**
 * The storage boundary for work traces: what a stored trace must look like to be read back. Anything else
 * is dropped as a whole, never repaired or migrated.
 */

const WORK_BLOCK_KINDS = new Set<ConversationWorkBlock['kind']>([
  'reasoning',
  'llm_turn',
  'approval',
  'user_input',
  'plan_review',
  'compaction',
  'handoff',
  'diagnostic',
  'output',
  'command',
  'task_snapshot',
]);

export function normalizeWorkBlockKind(value: unknown): ConversationWorkBlock['kind'] | null {
  return WORK_BLOCK_KINDS.has(value as ConversationWorkBlock['kind'])
    ? value as ConversationWorkBlock['kind']
    : null;
}
function isProviderOutputRef(value: unknown): value is ProviderOutputRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ref = value as Partial<ProviderOutputRef>;
  return typeof ref.protocol === 'string'
    && ref.protocol.trim().length > 0
    && typeof ref.providerBlockKey === 'string'
    && ref.providerBlockKey.trim().length > 0
    && Number.isInteger(ref.contentIndex)
    && Number(ref.contentIndex) >= 0
    && (ref.responseId === undefined || typeof ref.responseId === 'string')
    && (ref.itemId === undefined || typeof ref.itemId === 'string')
    && (ref.sourceIndex === undefined || (Number.isInteger(ref.sourceIndex) && Number(ref.sourceIndex) >= 0));
}

export function providerOutputRefKey(ref: ProviderOutputRef): string {
  return [
    ref.protocol,
    ref.responseId ?? '',
    ref.providerBlockKey,
    ref.sourceIndex ?? '',
    ref.itemId ?? '',
  ].join('\u0000');
}

function hasProviderChannelCollision(block: ConversationWorkBlock): boolean {
  const owners = new Map<string, 'thinking' | 'text' | 'tool_call'>();
  const claim = (ref: ProviderOutputRef | undefined, channel: 'thinking' | 'text' | 'tool_call'): boolean => {
    if (!ref) return false;
    if (!isProviderOutputRef(ref)) return true;
    const key = providerOutputRefKey(ref);
    const owner = owners.get(key);
    if (owner && owner !== channel) return true;
    owners.set(key, channel);
    return false;
  };
  for (const item of block.items ?? []) {
    if (claim(item.providerOutputRef, item.kind === 'thinking' ? 'thinking' : 'text')) return true;
  }
  for (const ref of block.result?.providerOutputRefs ?? []) {
    if (claim(ref, 'text')) return true;
  }
  for (const toolCall of block.toolCalls) {
    if (claim(toolCall.providerOutputRef, 'tool_call')) return true;
  }
  return false;
}

const LEGACY_BLOCK_FIELDS = ['thinking', 'thinkingStatus', 'thinkingDisplayOrder', 'outputItems'] as const;

const THINKING_ARTIFACT_KINDS: readonly unknown[] = ['summary', 'raw', 'opaque', 'unknown'] satisfies ThinkingArtifactKind[];

function isStoredLoopItem(item: unknown): item is ConversationLoopItem {
  if (!item || typeof item !== 'object') return false;
  const candidate = item as Record<string, unknown>;
  if (!isProviderOutputRef(candidate.providerOutputRef)) return false;
  if (!(candidate.status === 'streaming' || candidate.status === 'complete')) return false;
  if (!Number.isSafeInteger(candidate.displayOrder) || Number(candidate.displayOrder) < 1) return false;
  if (candidate.kind === 'text') {
    return typeof candidate.text === 'string'
      && (candidate.phase === undefined || candidate.phase === 'commentary' || candidate.phase === 'final_answer');
  }
  const thinking = candidate.thinking;
  return candidate.kind === 'thinking' && Boolean(thinking) && typeof thinking === 'object'
    && THINKING_ARTIFACT_KINDS.includes((thinking as Record<string, unknown>).kind);
}

/**
 * The stored trace when it matches the current shape. A record in another shape is dropped and the
 * message is flagged, so the transcript can say the process record came from an older version.
 */
export function readStoredWorkTrace(
  trace: ConversationWorkTrace | null | undefined,
): { workTrace: ConversationWorkTrace | null; workTraceDiscarded?: true } {
  if (!trace) return { workTrace: null };
  const workTrace = sanitizeStoredWorkTrace(trace);
  return workTrace ? { workTrace } : { workTrace: null, workTraceDiscarded: true };
}

export function sanitizeStoredWorkTrace(
  trace: ConversationWorkTrace | null | undefined,
): ConversationWorkTrace | null {
  if (!trace || typeof trace !== 'object') return null;
  if (!['idle', 'running', 'complete', 'error', 'stopped'].includes(trace.status)) return null;
  if (!Array.isArray(trace.blocks)) return null;

  // The trace comes back from storage typed but unchecked, so any entry may be null or another value.
  for (const block of trace.blocks as (ConversationWorkBlock | null)[]) {
    if (!block || typeof block !== 'object') return null;
    if (!normalizeWorkBlockKind(block.kind)) return null;
    if (typeof block.id !== 'string' || !block.id.trim()) return null;
    if (!['pending', 'running', 'complete', 'error', 'cancelled'].includes(block.status)) return null;
    if (!Array.isArray(block.toolCalls)) return null;
    if (block.displayOrder !== undefined && (!Number.isSafeInteger(block.displayOrder) || block.displayOrder < 1)) return null;
    if (block.parentLoopId !== undefined && (typeof block.parentLoopId !== 'string' || !block.parentLoopId)) return null;
    // Older process records kept one thinking slot and merged text; they are not read back.
    if (LEGACY_BLOCK_FIELDS.some((field) => field in block)) return null;
    if (block.result && 'text' in block.result) return null;
    if (block.items !== undefined && (!Array.isArray(block.items) || !block.items.every(isStoredLoopItem))) return null;
    for (const call of block.toolCalls as (ConversationToolCall | null)[]) {
      if (!call || typeof call !== 'object') return null;
      if (call.executionStartedAt !== undefined && (!Number.isFinite(call.executionStartedAt) || call.executionStartedAt < 0)) return null;
      if (call.displayOrder !== undefined && (!Number.isSafeInteger(call.displayOrder) || call.displayOrder < 1)) return null;
      if (call.hookDiagnostics !== undefined && (
        !Array.isArray(call.hookDiagnostics)
        || !(call.hookDiagnostics as (NonNullable<ConversationToolCall['hookDiagnostics']>[number] | null)[]).every((diagnostic) => diagnostic
          && typeof diagnostic.id === 'string'
          && typeof diagnostic.code === 'string'
          && ['info', 'warning', 'error'].includes(diagnostic.severity)
          && typeof diagnostic.message === 'string'
          && typeof diagnostic.timestamp === 'number'
          && Number.isFinite(diagnostic.timestamp))
      )) return null;
    }
    if (block.diagnosticSeverity !== undefined) {
      if (block.kind !== 'diagnostic') return null;
      if (!['info', 'warning', 'error'].includes(block.diagnosticSeverity)) return null;
    }
    if ('detail' in block && (block as { detail?: unknown }).detail !== undefined) return null;
    if ('thinkingPresentation' in block) return null;
    if (block.kind === 'llm_turn' && block.result && !Array.isArray(block.result.toolCallIds)) return null;
    if (block.result?.providerOutputRefs && (
      !Array.isArray(block.result.providerOutputRefs)
      || !block.result.providerOutputRefs.every(isProviderOutputRef)
    )) return null;
    if (hasProviderChannelCollision(block)) return null;
  }

  return trace;
}
