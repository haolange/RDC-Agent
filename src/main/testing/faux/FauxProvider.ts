/**
 * FauxProvider — 用于测试的 mock LLM Provider。
 *
 * 实现 `ProviderStrategy` 接口，支持预设响应序列、
 * 调用状态追踪和响应队列管理。
 *
 * 用法：
 * ```ts
 * const faux = createFauxProvider({ models: [testModel] });
 * faux.setResponses([{ text: 'Hello!' }]);
 * registry.register(faux.strategy);
 * const stream = registry.stream(testModel, context, options);
 * const msg = await stream.result();
 * expect(faux.state.callCount).toBe(1);
 * ```
 */

import { EventStream } from '../../agent-runtime/core/EventStream';
import type { ProviderStrategy } from '../../agent-runtime/core/ProviderRegistry';
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  StreamOptions,
  Usage,
} from '../../agent-runtime/core/types';

// =====================================================================
// Types
// =====================================================================

/** Simplified response definition for test convenience. */
export interface FauxResponse {
  /** Plain text content for the assistant message. */
  text?: string;
  /** Full or partial assistant message override. */
  message?: Partial<AssistantMessage>;
  /** Pre-built event sequence to emit instead of auto-generating events. */
  events?: AssistantMessageEvent[];
  /** Stop reason override (defaults to 'stop'). */
  stopReason?: AssistantMessage['stopReason'];
  /** Usage override. */
  usage?: Partial<Usage>;
}

export interface FauxProviderOptions {
  /** API protocol identifier (defaults to 'faux'). */
  api?: string;
  /** Models this provider claims to support. */
  models?: Model[];
}

export interface FauxProviderState {
  callCount: number;
  lastContext?: Context;
  lastModel?: Model;
  lastOptions?: StreamOptions;
}

export interface FauxProvider {
  /** The ProviderStrategy implementation to register with a ProviderRegistry. */
  readonly strategy: ProviderStrategy;
  /** API protocol identifier. */
  readonly api: string;
  /** Models this provider supports. */
  readonly models: Model[];
  /** Mutable call state for assertions. */
  readonly state: FauxProviderState;
  /** Replace the response queue. */
  setResponses: (responses: FauxResponse[]) => void;
  /** Append responses to the queue. */
  appendResponses: (responses: FauxResponse[]) => void;
  /** Number of pending (not yet consumed) responses. */
  getPendingResponseCount: () => number;
  /** Get a model by id. */
  getModel: (id: string) => Model | undefined;
}

// =====================================================================
// Helpers
// =====================================================================

const DEFAULT_USAGE: Usage = {
  inputTokens: 10,
  outputTokens: 20,
  totalTokens: 30,
};

function buildAssistantMessage(
  model: Model,
  response: FauxResponse,
): AssistantMessage {
  const text = response.text ?? '';
  const base: AssistantMessage = {
    role: 'assistant',
    content: text ? [{ type: 'text', text }] : [],
    model: model.id,
    provider: model.provider,
    usage: { ...DEFAULT_USAGE, ...response.usage },
    stopReason: response.stopReason ?? 'stop',
    timestamp: Date.now(),
  };
  if (response.message) {
    return { ...base, ...response.message };
  }
  return base;
}

function emitResponseEvents(
  stream: EventStream<AssistantMessageEvent, AssistantMessage>,
  message: AssistantMessage,
  response: FauxResponse,
): void {
  // If pre-built events are provided, emit them directly.
  if (response.events && response.events.length > 0) {
    for (const event of response.events) {
      stream.push(event);
    }
    // Ensure stream completes if no done/error event was included.
    if (!response.events.some((e) => e.type === 'done' || e.type === 'error')) {
      stream.push({ type: 'done', reason: message.stopReason, message });
    }
    return;
  }

  // Auto-generate standard event sequence.
  stream.push({ type: 'start', partial: message });

  const textBlocks = message.content.filter((b) => b.type === 'text');
  for (let i = 0; i < textBlocks.length; i++) {
    const block = textBlocks[i];
    if (block.type !== 'text') continue;
    const contentIndex = message.content.indexOf(block);
    const ref = {
      protocol: 'faux',
      providerBlockKey: `faux-block-${i}`,
      contentIndex,
    };
    stream.push({
      type: 'text_start',
      contentIndex,
      providerOutputRef: ref,
      partial: message,
    });
    stream.push({
      type: 'text_delta',
      contentIndex,
      delta: block.text,
      providerOutputRef: ref,
      partial: message,
    });
    stream.push({
      type: 'text_end',
      contentIndex,
      content: block.text,
      providerOutputRef: ref,
      partial: message,
    });
  }

  stream.push({ type: 'done', reason: message.stopReason, message });
}

// =====================================================================
// Factory
// =====================================================================

/**
 * Create a FauxProvider for use in tests.
 *
 * The returned object exposes a `strategy` property implementing
 * `ProviderStrategy` that can be registered with any `ProviderRegistry`.
 */
export function createFauxProvider(options?: FauxProviderOptions): FauxProvider {
  const api = options?.api ?? 'faux';
  const models = options?.models ?? [];

  const state: FauxProviderState = { callCount: 0 };
  let responseQueue: FauxResponse[] = [];

  const strategy: ProviderStrategy = {
    api,
    stream(
      model: Model,
      context: Context,
      streamOptions: StreamOptions,
    ): EventStream<AssistantMessageEvent, AssistantMessage> {
      state.callCount++;
      state.lastContext = context;
      state.lastModel = model;
      state.lastOptions = streamOptions;

      const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
        (e) => e.type === 'done' || e.type === 'error',
        (e) => {
          if (e.type === 'done') return e.message;
          // error event
          return (e as { message: AssistantMessage }).message;
        },
      );

      // Dequeue next response asynchronously to mimic real provider behavior.
      queueMicrotask(() => {
        const response = responseQueue.shift();
        if (!response) {
          const errorMsg: AssistantMessage = {
            role: 'assistant',
            content: [],
            model: model.id,
            provider: model.provider,
            usage: { ...DEFAULT_USAGE },
            stopReason: 'error',
            timestamp: Date.now(),
          };
          stream.push({
            type: 'error',
            error: new Error('FauxProvider: no pending responses'),
            message: errorMsg,
          });
          return;
        }
        const message = buildAssistantMessage(model, response);
        emitResponseEvents(stream, message, response);
      });

      return stream;
    },
  };

  return {
    strategy,
    api,
    models,
    state,
    setResponses(responses: FauxResponse[]): void {
      responseQueue = [...responses];
    },
    appendResponses(responses: FauxResponse[]): void {
      responseQueue.push(...responses);
    },
    getPendingResponseCount(): number {
      return responseQueue.length;
    },
    getModel(id: string): Model | undefined {
      return models.find((m) => m.id === id);
    },
  };
}
