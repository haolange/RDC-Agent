import type { ProviderOutputRef } from '../../core/types';
import { AssistantStreamBuilder, createProviderOutputRef } from './AssistantStreamBuilder';

export type StreamChannelKind = 'text' | 'thinking';

export interface StreamChannelRefInput {
  providerBlockKey: string;
  sourceIndex?: number;
  itemId?: string;
  responseId?: string;
}

export class StreamChannelRefs {
  private readonly protocol: string;
  private readonly refs = new Map<string, ProviderOutputRef>();
  private nextContentIndex = 0;

  constructor(protocol: string) {
    this.protocol = protocol;
  }

  ref(input: StreamChannelRefInput): ProviderOutputRef {
    const key = [
      input.responseId ?? '',
      input.providerBlockKey,
      input.sourceIndex ?? '',
      input.itemId ?? '',
    ].join('\u0000');
    const existing = this.refs.get(key);
    if (existing) return existing;
    const created = createProviderOutputRef({
      protocol: this.protocol,
      providerBlockKey: input.providerBlockKey,
      contentIndex: this.nextContentIndex,
      ...(input.sourceIndex !== undefined ? { sourceIndex: input.sourceIndex } : {}),
      ...(input.itemId ? { itemId: input.itemId } : {}),
      ...(input.responseId ? { responseId: input.responseId } : {}),
    });
    this.nextContentIndex += 1;
    this.refs.set(key, created);
    return created;
  }
}

export interface AlternatingChannelSwitch {
  close?: { kind: StreamChannelKind; ref: ProviderOutputRef };
  ref: ProviderOutputRef;
  started: boolean;
}

/**
 * Chat Completions / Gemini / Ollama have no stable cross-chunk block id.
 * Consecutive deltas of the same kind share one ref; a kind switch closes the
 * previous segment and opens a new one.
 */
export class AlternatingTextThinkingChannels {
  private readonly channels: StreamChannelRefs;
  private active: { kind: StreamChannelKind; ref: ProviderOutputRef } | null = null;
  private ordinal = 0;

  constructor(channels: StreamChannelRefs) {
    this.channels = channels;
  }

  ensure(kind: StreamChannelKind): AlternatingChannelSwitch {
    if (this.active?.kind === kind) {
      return { ref: this.active.ref, started: false };
    }
    const close = this.active ? { kind: this.active.kind, ref: this.active.ref } : undefined;
    this.ordinal += 1;
    const ref = this.channels.ref({
      providerBlockKey: kind === 'text' ? `virtual:text:${this.ordinal}` : `virtual:thinking:${this.ordinal}`,
      sourceIndex: this.ordinal,
    });
    this.active = { kind, ref };
    return { close, ref, started: true };
  }
}

export function closeSwitchedChannel(
  builder: AssistantStreamBuilder,
  closed: { kind: StreamChannelKind; ref: ProviderOutputRef } | undefined,
): void {
  if (!closed) return;
  if (closed.kind === 'text') builder.endText(closed.ref);
  else builder.endThinking(closed.ref);
}
