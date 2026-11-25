import type { ConversationMessage, ConversationWorkBlock, ConversationWorkTrace } from '../types/conversation';

/**
 * Streaming updates of one assistant message as deltas. A turn commits its message many times per step; sending the
 * whole message each time made one update grow with the trace and a long investigation cost a quadratic total. The
 * encoder (main) sends what changed since its previous send for the same message; the reducer (renderer) rebuilds the
 * message. `seq` counts the sends for a message and `baseSeq` names the send a delta builds on; the first send has
 * `baseSeq: 0` and carries everything, so it is a complete message on its own.
 */
export interface ConversationMessageDelta {
  messageId: string;
  seq: number;
  baseSeq: number;
  /** Top-level fields that changed, `workTrace` excluded. */
  fields: Partial<ConversationMessage>;
  /** Top-level fields the message no longer has. */
  removed?: Array<keyof ConversationMessage>;
  /** Absent when the trace did not change; `null` when the message has no trace any more. */
  trace?: ConversationMessageTraceDelta | null;
}

export interface ConversationMessageTraceDelta {
  /** Everything except `blocks`, sent when any of it changed. */
  meta?: Omit<ConversationWorkTrace, 'blocks'>;
  /** The block order, sent when blocks were added, removed or reordered. */
  blockIds?: string[];
  /** Blocks whose content changed (or that are new), by id. */
  blocks: ConversationWorkBlock[];
}

interface EncoderEntry {
  seq: number;
  message: ConversationMessage;
  fieldJson: Map<string, string>;
  traceMetaJson: string | null;
  blockIds: string[];
  blockJson: Map<string, string>;
}

const traceMetaOf = (trace: ConversationWorkTrace): Omit<ConversationWorkTrace, 'blocks'> => {
  const { blocks: _blocks, ...meta } = trace;
  return meta;
};

const sameOrder = (left: readonly string[], right: readonly string[]): boolean => (
  left.length === right.length && left.every((id, index) => id === right[index])
);

export interface ConversationMessageDeltaEncoder {
  /** The delta for this message since the previous send, or `null` when nothing changed. */
  encode(message: ConversationMessage): ConversationMessageDelta | null;
  /** The last sent state of a streaming message, for a receiver that lost the sequence. */
  snapshot(messageId: string): { seq: number; message: ConversationMessage } | null;
  /** Ends the stream of a message (completed, errored or discarded). */
  forget(messageId: string): void;
}

export function createConversationMessageDeltaEncoder(): ConversationMessageDeltaEncoder {
  const entries = new Map<string, EncoderEntry>();

  return {
    encode(message) {
      const previous = entries.get(message.id);
      const fields: Partial<ConversationMessage> = {};
      const removed: Array<keyof ConversationMessage> = [];
      const fieldJson = new Map<string, string>();
      for (const [key, value] of Object.entries(message) as Array<[keyof ConversationMessage, unknown]>) {
        if (key === 'workTrace' || value === undefined) continue;
        const json = JSON.stringify(value);
        fieldJson.set(key, json);
        if (previous?.fieldJson.get(key) !== json) (fields as Record<string, unknown>)[key] = value;
      }
      for (const key of previous?.fieldJson.keys() ?? []) {
        if (!fieldJson.has(key)) removed.push(key as keyof ConversationMessage);
      }

      let trace: ConversationMessageTraceDelta | null | undefined;
      let traceMetaJson: string | null = null;
      let blockIds: string[] = [];
      const blockJson = new Map<string, string>();
      if (message.workTrace) {
        const meta = traceMetaOf(message.workTrace);
        traceMetaJson = JSON.stringify(meta);
        blockIds = message.workTrace.blocks.map((block) => block.id);
        const changedBlocks: ConversationWorkBlock[] = [];
        for (const block of message.workTrace.blocks) {
          const json = JSON.stringify(block);
          blockJson.set(block.id, json);
          if (previous?.blockJson.get(block.id) !== json) changedBlocks.push(block);
        }
        const metaChanged = previous?.traceMetaJson !== traceMetaJson;
        const orderChanged = !previous || !sameOrder(previous.blockIds, blockIds);
        if (metaChanged || orderChanged || changedBlocks.length > 0) {
          trace = {
            ...(metaChanged ? { meta } : {}),
            ...(orderChanged ? { blockIds } : {}),
            blocks: changedBlocks,
          };
        }
      } else {
        // A trace that disappeared is sent as `null`; so is an explicit `null` on the first send.
        const hadTrace = previous !== undefined && previous.traceMetaJson !== null;
        if (hadTrace || (!previous && message.workTrace === null)) trace = null;
      }

      if (previous && Object.keys(fields).length === 0 && removed.length === 0 && trace === undefined) return null;
      const seq = (previous?.seq ?? 0) + 1;
      entries.set(message.id, { seq, message, fieldJson, traceMetaJson, blockIds, blockJson });
      return {
        messageId: message.id,
        seq,
        baseSeq: previous?.seq ?? 0,
        fields,
        ...(removed.length ? { removed } : {}),
        ...(trace !== undefined ? { trace } : {}),
      };
    },
    snapshot(messageId) {
      const entry = entries.get(messageId);
      return entry ? { seq: entry.seq, message: entry.message } : null;
    },
    forget(messageId) {
      entries.delete(messageId);
    },
  };
}

/**
 * Applies a delta to the message it builds on. A delta with `baseSeq: 0` is complete and needs no base; any other
 * delta must be applied to the state of send `baseSeq`, which the caller checks before calling.
 */
export function applyConversationMessageDelta(
  base: ConversationMessage | undefined,
  delta: ConversationMessageDelta,
): ConversationMessage {
  const start: Partial<ConversationMessage> = delta.baseSeq === 0 ? {} : { ...base };
  for (const key of delta.removed ?? []) delete start[key];
  const next = { ...start, ...delta.fields } as ConversationMessage;
  if (delta.trace === null) {
    next.workTrace = null;
    return next;
  }
  if (delta.trace === undefined) {
    if (delta.baseSeq !== 0) next.workTrace = base?.workTrace;
    return next;
  }
  const previousTrace = delta.baseSeq === 0 ? undefined : base?.workTrace ?? undefined;
  const changed = new Map(delta.trace.blocks.map((block) => [block.id, block]));
  const previousBlocks = new Map((previousTrace?.blocks ?? []).map((block) => [block.id, block]));
  const order = delta.trace.blockIds ?? (previousTrace?.blocks ?? []).map((block) => block.id);
  const meta = delta.trace.meta ?? (previousTrace ? traceMetaOf(previousTrace) : undefined);
  next.workTrace = {
    ...(meta as Omit<ConversationWorkTrace, 'blocks'>),
    blocks: order.map((id) => (changed.get(id) ?? previousBlocks.get(id))!),
  };
  return next;
}
