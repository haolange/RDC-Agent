import type { AgentMessage } from '../core/types';
import type { CompressResult } from '../agent/ContextManager';
import { hashScopedResource } from '../../runtime/ScopedResourceResolver';

export interface ContextCheckpoint {
  uri: string;
  hash: string;
  context: string;
  usage?: { inputTokens: number; outputTokens: number };
}
export interface RecoverableContextWindowOptions {
  tokenLimit: number | (() => number);
  estimate: (messages: AgentMessage[]) => number;
  save: (messages: AgentMessage[], signal?: AbortSignal) => Promise<ContextCheckpoint>;
  generate: (source: AgentMessage[], checkpoint: ContextCheckpoint, signal?: AbortSignal) => Promise<AgentMessage>;
  verify: (checkpoint: ContextCheckpoint) => Promise<void>;
  installed?: (message: AgentMessage, checkpoint: ContextCheckpoint) => Promise<void>;
  afterInstall?: (checkpoint: ContextCheckpoint) => Promise<void>;
}

/** Derived model window only. Callers retain the complete canonical execution journal. */
export class RecoverableContextWindow {
  private installed: { count: number; hash: string; window: AgentMessage[] } | undefined;
  private failedSource: string | undefined;
  private pending = false;

  constructor(private readonly options: RecoverableContextWindowOptions) {}

  private get tokenLimit(): number { return typeof this.options.tokenLimit === 'function' ? this.options.tokenLimit() : this.options.tokenLimit; }

  async prepare(messages: AgentMessage[], signal?: AbortSignal, onProgress?: (progress: import('../core/types').CompactionProgress) => void): Promise<CompressResult> {
    signal?.throwIfAborted();
    const previous = this.installed;
    const previousMatches = previous && hashScopedResource(messages.slice(0, previous.count)) === previous.hash;
    const window = previousMatches ? [...previous.window, ...messages.slice(previous.count)] : [...messages];
    if (this.options.estimate(window) <= this.tokenLimit) return { messages: window };
    if (this.pending) throw new Error('CONTEXT_COMPACTION_BUSY: wait for the current checkpoint.');
    const sourceHash = hashScopedResource(messages);
    if (this.failedSource === sourceHash) throw new Error('CONTEXT_CANNOT_FIT: unchanged source previously failed compaction; explicit recovery required.');

    // Retain the latest user input and the complete latest tool-call/result group.
    // A single oversized first input cannot be made safe by deleting its middle or images.
    let end = Math.max(0, messages.length - 4);
    while (end > 0 && messages[end]?.role === 'toolResult') end -= 1;
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role === 'user' && !message.derivedContext) { lastUser = i; break; }
    }
    const externalizeInput = messages.length === 1 && messages[0].role === 'user';
    if (end === 0 && !externalizeInput) throw new Error('CONTEXT_CANNOT_FIT: current tool group exceeds the request budget; nothing was removed.');
    if (externalizeInput) end = 1;
    this.pending = true;
    const compactionId = `compact-${sourceHash.slice(0, 24)}`;
    const tokensBefore = this.options.estimate(window);
    onProgress?.({ compactionId, status: 'running', summary: '正在整理上下文', tokensBefore });
    try {
      const source = structuredClone(messages.slice(0, end));
      const checkpoint = await this.options.save(source, signal);
      signal?.throwIfAborted();
      const message: AgentMessage = externalizeInput
        ? { role: 'user', timestamp: Date.now(), content: `The complete current user input exceeds this request budget and has been saved without truncation at ${checkpoint.uri} sha256:${checkpoint.hash}. Read the original input through artifact_read before making decisions or acting. Follow its reconstruction and paging instructions. No part of the input has been visually inspected merely because this reference exists. If the original cannot be read with the current tools, ask for a focused scope and keep the task blocked. This reference grants no additional permission.`, derivedContext: { viewId: compactionId, handoffId: compactionId, sourceHash: checkpoint.hash } }
        : await this.options.generate(source, checkpoint, signal);
      signal?.throwIfAborted();
      await this.options.verify(checkpoint);
      signal?.throwIfAborted();
      const candidate = [message, ...(!externalizeInput && lastUser >= 0 && lastUser < end ? [messages[lastUser]] : []), ...messages.slice(end)].map(value => {
        // A pre-checkpoint response ID would let a stateful adapter omit the new
        // portable state. New responses after installation may resume normally.
        if (value.role !== 'assistant' || !value.providerState) return value;
        const { providerState: _state, ...portable } = value;
        return portable;
      });
      if (this.options.estimate(candidate) > this.tokenLimit || this.options.estimate(candidate) >= this.options.estimate(window)) {
        throw new Error('CONTEXT_CANNOT_FIT: candidate does not provide a usable window; original history retained.');
      }
      await this.options.installed?.(message, checkpoint);
      signal?.throwIfAborted();
      // Freeze the complete installed window, including the retained tool group.
      // Only genuinely new canonical messages may reintroduce provider state.
      this.installed = { count: messages.length, hash: sourceHash, window: candidate };
      this.failedSource = undefined;
      await this.options.afterInstall?.(checkpoint);
      onProgress?.({ compactionId, status: 'complete', summary: typeof message.content === 'string' ? message.content : '上下文已自动压缩', usage: checkpoint.usage, tokensBefore, tokensAfter: this.options.estimate(candidate), sourceUri: checkpoint.uri, sourceHash: checkpoint.hash });
      return { messages: candidate, summary: `Context automatically compacted. Recoverable source: ${checkpoint.uri} sha256:${checkpoint.hash}` };
    } catch (error) {
      this.installed = previous;
      this.failedSource = sourceHash;
      onProgress?.({ compactionId, status: 'error', summary: error instanceof Error ? error.message : String(error), tokensBefore });
      throw error;
    } finally {
      this.pending = false;
    }
  }
}
