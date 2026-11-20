import { AssistantStreamBuilder } from './AssistantStreamBuilder';
import { StreamChannelRefs } from './streamChannelRefs';
import type { ProviderContinuationArtifact } from '../../core/types';
import type { ThinkingArtifactSource } from '../../core/types';
import type { ThinkingContentInput } from '../../reasoning/ReasoningArtifacts';
import type { ReasoningEventSummary } from '@shared/types/reasoning';

export type ResponsesThinkingMode = 'summary' | 'raw' | 'opaque';

export interface ResponsesItemIdentity {
  outputIndex: number;
  itemId?: string;
}

interface ReasoningItemState {
  identity: ResponsesItemIdentity;
  key: string;
  started: boolean;
  closed: boolean;
  mode: ResponsesThinkingMode;
  lastSummaryIndex?: number;
  /** Summary text received so far per summary_index, from deltas and completions alike. */
  summaryParts: Map<number, string>;
  artifact?: ProviderContinuationArtifact;
}

/** How one reasoning summary part arrived: streamed length, completed length, and whether completion filled a gap. */
export type SummaryPartReport = ReasoningEventSummary['summaryParts'][number];

interface TextItemState {
  identity: ResponsesItemIdentity;
  key: string;
  started: boolean;
  closed: boolean;
  phase?: 'commentary' | 'final_answer';
}

export class ResponsesItemChannels {
  private readonly builder: AssistantStreamBuilder;
  private readonly channels: StreamChannelRefs;
  private readonly sources: {
    summary: ThinkingArtifactSource;
    raw: ThinkingArtifactSource;
    opaque: ThinkingArtifactSource;
  };
  private readonly deepSeekResponses: boolean;
  private readonly itemIndexById = new Map<string, number>();
  private readonly reasoning = new Map<string, ReasoningItemState>();
  private readonly summaryReports = new Map<string, SummaryPartReport>();
  private readonly texts = new Map<string, TextItemState>();

  constructor(input: {
    protocol: string;
    builder: AssistantStreamBuilder;
    sources: {
      summary: ThinkingArtifactSource;
      raw: ThinkingArtifactSource;
      opaque: ThinkingArtifactSource;
    };
    deepSeekResponses?: boolean;
  }) {
    this.builder = input.builder;
    this.channels = new StreamChannelRefs(input.protocol);
    this.sources = input.sources;
    this.deepSeekResponses = input.deepSeekResponses === true;
  }

  identityFromEvent(
    event: Record<string, unknown>,
    item?: Record<string, unknown> | null,
  ): ResponsesItemIdentity {
    const itemId = readString(event.item_id) || readString(item?.id) || undefined;
    const outputIndex = readNumber(event.output_index)
      ?? (itemId ? this.itemIndexById.get(itemId) : undefined)
      ?? 0;
    return this.remember({ outputIndex, itemId });
  }

  remember(identity: ResponsesItemIdentity): ResponsesItemIdentity {
    if (identity.itemId) this.itemIndexById.set(identity.itemId, identity.outputIndex);
    return identity;
  }

  toolRef(identity: ResponsesItemIdentity): ReturnType<StreamChannelRefs['ref']> {
    this.remember(identity);
    return this.channels.ref({
      providerBlockKey: `output:tool:${identity.outputIndex}`,
      sourceIndex: identity.outputIndex,
      itemId: identity.itemId,
    });
  }

  startReasoning(
    identity: ResponsesItemIdentity,
    mode: ResponsesThinkingMode,
    artifact?: ProviderContinuationArtifact,
  ): void {
    if (this.deepSeekResponses && mode === 'opaque') {
      this.reasoningState(identity, mode, artifact);
      return;
    }
    const state = this.reasoningState(identity, mode, artifact);
    if (state.closed || state.started) {
      if (!state.closed && artifact) {
        this.builder.updateThinking(this.reasoningRef(state), this.meta(state.mode, artifact));
      }
      return;
    }
    this.builder.startThinking(this.reasoningRef(state), this.meta(mode, artifact));
    state.started = true;
    state.mode = mode;
  }

  appendReasoning(
    identity: ResponsesItemIdentity,
    delta: string,
    mode: ResponsesThinkingMode,
    artifact?: ProviderContinuationArtifact,
    summaryIndex?: number,
  ): void {
    const state = this.reasoningState(identity, mode, artifact);
    if (state.closed) return;
    this.startReasoning(identity, mode, artifact);
    if (state.closed || !state.started) return;
    if (mode !== state.mode) {
      state.mode = mode;
      this.builder.updateThinking(this.reasoningRef(state), this.meta(mode, artifact ?? state.artifact));
    }
    if (summaryIndex !== undefined && (state.lastSummaryIndex === undefined || summaryIndex > state.lastSummaryIndex)) {
      if (state.lastSummaryIndex !== undefined) {
        this.builder.appendThinking(this.reasoningRef(state), '\n\n', this.meta(mode, artifact ?? state.artifact));
      }
      state.lastSummaryIndex = summaryIndex;
    }
    if (delta) {
      this.builder.appendThinking(this.reasoningRef(state), delta, this.meta(mode, artifact ?? state.artifact));
      if (mode === 'summary') this.recordSummaryText(state, summaryIndex ?? 0, delta);
    }
  }

  /**
   * A completion event (`summary_text.done`, `summary_part.done`, or a finished item's `summary[]`) carries the
   * whole part. Text already streamed is kept; only what the stream missed is appended: everything when nothing
   * streamed, the missing suffix when the stream is a prefix. A completion that disagrees with streamed text
   * cannot rewrite what was already shown, so the streamed text stands.
   */
  completeSummaryPart(identity: ResponsesItemIdentity, summaryIndex: number, fullText: string): void {
    const state = this.reasoningState(identity, 'summary');
    const report = this.summaryReport(state, summaryIndex);
    report.completedChars = fullText.length;
    const streamed = state.summaryParts.get(summaryIndex) ?? '';
    if (state.closed || !fullText || fullText === streamed || (streamed && !fullText.startsWith(streamed))) return;
    report.recovered = true;
    if (!streamed && state.lastSummaryIndex !== undefined && summaryIndex < state.lastSummaryIndex) {
      // An earlier part that never streamed arrives after later ones: append it as its own paragraph.
      this.startReasoning(identity, 'summary');
      this.builder.appendThinking(this.reasoningRef(state), `\n\n${fullText}`, this.meta('summary', state.artifact));
      state.summaryParts.set(summaryIndex, fullText);
      return;
    }
    const missing = fullText.slice(streamed.length);
    const streamedChars = report.streamedChars;
    this.appendReasoning(identity, missing, 'summary', undefined, summaryIndex);
    report.streamedChars = streamedChars;
  }

  /** Event-level shape of every reasoning summary part in this response: lengths only, never text. */
  summaryPartReports(): SummaryPartReport[] {
    return [...this.summaryReports.values()].sort((left, right) => left.itemKey.localeCompare(right.itemKey) || left.index - right.index);
  }

  private recordSummaryText(state: ReasoningItemState, summaryIndex: number, text: string): void {
    state.summaryParts.set(summaryIndex, `${state.summaryParts.get(summaryIndex) ?? ''}${text}`);
    this.summaryReport(state, summaryIndex).streamedChars += text.length;
  }

  private summaryReport(state: ReasoningItemState, summaryIndex: number): SummaryPartReport {
    const key = `${state.key}#${summaryIndex}`;
    const existing = this.summaryReports.get(key);
    if (existing) return existing;
    const created: SummaryPartReport = { itemKey: state.key, index: summaryIndex, streamedChars: 0, recovered: false };
    this.summaryReports.set(key, created);
    return created;
  }

  updateReasoning(
    identity: ResponsesItemIdentity,
    mode: ResponsesThinkingMode,
    artifact?: ProviderContinuationArtifact,
  ): void {
    const state = this.reasoningState(identity, mode, artifact);
    if (!state.started || state.closed) return;
    this.builder.updateThinking(this.reasoningRef(state), this.meta(mode, artifact ?? state.artifact));
  }

  closeReasoning(
    identity: ResponsesItemIdentity,
    artifact?: ProviderContinuationArtifact,
  ): void {
    const state = this.reasoning.get(itemKey('reasoning', identity));
    if (!state || state.closed) return;
    if (artifact) state.artifact = artifact;
    if (state.started) {
      this.builder.endThinking(this.reasoningRef(state), this.meta(state.mode, state.artifact));
    }
    state.closed = true;
  }

  appendText(identity: ResponsesItemIdentity, delta: string): void {
    const state = this.textState(identity);
    if (state.closed) return;
    if (!state.started) {
      this.builder.startText(this.textRef(state), state.phase);
      state.started = true;
    }
    if (delta) this.builder.appendText(this.textRef(state), delta);
  }

  setTextPhase(identity: ResponsesItemIdentity, phase: 'commentary' | 'final_answer' | undefined): void {
    if (!phase) return;
    const state = this.textState(identity);
    if (state.phase && state.phase !== phase) throw new Error('Provider changed an output item phase.');
    state.phase = phase;
    if (state.started && !state.closed) this.builder.updateTextPhase(this.textRef(state), phase);
  }

  closeText(identity: ResponsesItemIdentity): void {
    const state = this.texts.get(itemKey('text', identity));
    if (!state || state.closed) return;
    if (state.started) this.builder.endText(this.textRef(state));
    state.closed = true;
  }

  applyCompletedReasoning(
    output: unknown[] | undefined,
    createArtifact: (item: Record<string, unknown>) => ProviderContinuationArtifact | undefined,
  ): void {
    if (!Array.isArray(output)) return;
    for (const [index, raw] of output.entries()) {
      const item = readRecord(raw);
      if (!item) continue;
      const artifact = createArtifact(item);
      if (!artifact) continue;
      const identity = this.remember({
        outputIndex: this.itemIndexById.get(readString(item.id)) ?? index,
        itemId: readString(item.id) || undefined,
      });
      const state = this.reasoningState(identity, 'opaque', artifact);
      if (state.started && !state.closed) {
        this.builder.updateThinking(this.reasoningRef(state), this.meta(state.mode, artifact));
      }
    }
  }

  closeRemaining(): void {
    for (const state of this.reasoning.values()) {
      if (state.started && !state.closed) {
        this.builder.endThinking(this.reasoningRef(state), this.meta(state.mode, state.artifact));
        state.closed = true;
      }
    }
    for (const state of this.texts.values()) {
      if (state.started && !state.closed) {
        this.builder.endText(this.textRef(state));
        state.closed = true;
      }
    }
  }

  private reasoningState(
    identity: ResponsesItemIdentity,
    mode: ResponsesThinkingMode,
    artifact?: ProviderContinuationArtifact,
  ): ReasoningItemState {
    const key = itemKey('reasoning', identity);
    const existing = this.reasoning.get(key);
    if (existing) {
      if (artifact) existing.artifact = artifact;
      return existing;
    }
    const created: ReasoningItemState = {
      identity: this.remember(identity),
      key,
      started: false,
      closed: false,
      mode,
      summaryParts: new Map(),
      artifact,
    };
    this.reasoning.set(key, created);
    return created;
  }

  private textState(identity: ResponsesItemIdentity): TextItemState {
    const key = itemKey('text', identity);
    const existing = this.texts.get(key);
    if (existing) return existing;
    const created: TextItemState = {
      identity: this.remember(identity),
      key,
      started: false,
      closed: false,
    };
    this.texts.set(key, created);
    return created;
  }

  private reasoningRef(state: ReasoningItemState) {
    return this.channels.ref({
      providerBlockKey: `output:reasoning:${state.identity.outputIndex}`,
      sourceIndex: state.identity.outputIndex,
      itemId: state.identity.itemId,
    });
  }

  private textRef(state: TextItemState) {
    return this.channels.ref({
      providerBlockKey: `output:text:${state.identity.outputIndex}`,
      sourceIndex: state.identity.outputIndex,
      itemId: state.identity.itemId,
    });
  }

  private meta(mode: ResponsesThinkingMode, artifact?: ProviderContinuationArtifact): ThinkingContentInput {
    return {
      kind: mode,
      source: mode === 'raw' ? this.sources.raw : mode === 'summary' ? this.sources.summary : this.sources.opaque,
      visibility: mode === 'raw' ? 'raw-collapsed' : mode === 'summary' ? 'summary' : 'hidden',
      continuation: artifact,
    };
  }
}

function itemKey(kind: 'reasoning' | 'text', identity: ResponsesItemIdentity): string {
  return `${kind}:${identity.itemId ?? identity.outputIndex}`;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
