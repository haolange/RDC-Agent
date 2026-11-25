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

/** A value as it was last sent, with its serialized form for comparing a later value that is not the same object. */
interface SentValue<T> {
  value: T;
  json: string;
}

interface EncoderEntry {
  seq: number;
  message: ConversationMessage;
  fields: Map<string, SentValue<unknown>>;
  traceMetaJson: string | null;
  blockIds: string[];
  /** The last sent version of each block of the trace, by id; empty when the message has no trace. */
  blocks: Map<string, SentValue<ConversationWorkBlock>>;
}

const traceMetaOf = (trace: ConversationWorkTrace): Omit<ConversationWorkTrace, 'blocks'> => {
  const { blocks: _blocks, ...meta } = trace;
  return meta;
};

const sameBlockOrder = (ids: readonly string[], blocks: readonly ConversationWorkBlock[]): boolean => (
  ids.length === blocks.length && blocks.every((block, index) => block.id === ids[index])
);

/**
 * The fields of `message` as sent now, and which of them changed. A value that is the same object (or the same
 * primitive) as the one sent last time is unchanged without being serialized again.
 */
function encodeFields(message: ConversationMessage, previous: EncoderEntry | undefined) {
  const changed: Partial<ConversationMessage> = {};
  const removed: Array<keyof ConversationMessage> = [];
  const sent = new Map<string, SentValue<unknown>>();
  for (const [key, value] of Object.entries(message) as Array<[keyof ConversationMessage, unknown]>) {
    if (key === 'workTrace' || value === undefined) continue;
    const before = previous?.fields.get(key);
    if (before && before.value === value) {
      sent.set(key, before);
      continue;
    }
    const json = JSON.stringify(value);
    sent.set(key, { value, json });
    if (before?.json !== json) (changed as Record<string, unknown>)[key] = value;
  }
  for (const key of previous?.fields.keys() ?? []) {
    if (!sent.has(key)) removed.push(key as keyof ConversationMessage);
  }
  return { changed, removed, sent };
}

export interface ConversationMessageDeltaEncoder {
  /** The delta for this message since the previous send, or `null` when nothing changed. */
  encode(message: ConversationMessage): ConversationMessageDelta | null;
  /** The last sent state of a streaming message, for a receiver that lost the sequence. */
  snapshot(messageId: string): { seq: number; message: ConversationMessage } | null;
  /** Ends the stream of a message (completed, errored or discarded). */
  forget(messageId: string): void;
}

/**
 * The work of one encode follows what changed, not the length of the message. Main updates a message by copying
 * only what it edits and sharing everything else with the previous version (`ConversationWorkTrace` copies one block
 * per edit); nothing already sent is mutated. So a block (or field value) that is the same object as the one sent
 * last time is unchanged and is not serialized; only blocks that are new objects are serialized and compared with
 * what was sent for the same id. A new object with the same content still counts as unchanged.
 */
export function createConversationMessageDeltaEncoder(): ConversationMessageDeltaEncoder {
  const entries = new Map<string, EncoderEntry>();

  return {
    encode(message) {
      const previous = entries.get(message.id);
      const { changed: fields, removed, sent } = encodeFields(message, previous);

      let trace: ConversationMessageTraceDelta | null | undefined;
      let traceMetaJson: string | null = null;
      let blockIds: string[] = [];
      let blocks = new Map<string, SentValue<ConversationWorkBlock>>();
      if (message.workTrace) {
        const meta = traceMetaOf(message.workTrace);
        traceMetaJson = JSON.stringify(meta);
        const current = message.workTrace.blocks;
        const sentBlocks = previous?.blocks ?? blocks;
        const sameOrder = previous !== undefined && sameBlockOrder(previous.blockIds, current);
        const orderChanged = !sameOrder;
        blockIds = sameOrder ? previous.blockIds : current.map((block) => block.id);
        // Same order: the previous map is updated in place. A changed order rebuilds it, so a removed block
        // does not stay behind and a block that comes back is sent again.
        blocks = sameOrder ? sentBlocks : new Map();
        const changedBlocks: ConversationWorkBlock[] = [];
        for (const block of current) {
          const before = sentBlocks.get(block.id);
          if (before && before.value === block) {
            if (orderChanged) blocks.set(block.id, before);
            continue;
          }
          const json = JSON.stringify(block);
          blocks.set(block.id, { value: block, json });
          if (before?.json !== json) changedBlocks.push(block);
        }
        const metaChanged = previous?.traceMetaJson !== traceMetaJson;
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
      entries.set(message.id, { seq, message, fields: sent, traceMetaJson, blockIds, blocks });
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
