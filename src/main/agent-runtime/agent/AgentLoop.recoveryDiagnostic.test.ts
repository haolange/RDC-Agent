import { describe, expect, it, vi } from 'vitest';
import { EventStream } from '../core/EventStream';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import { agentLoop, type AgentContext } from './AgentLoop';
import { AgentRecoveryAbortError, ErrorRecovery } from './ErrorRecovery';
import { ProviderEmptyStreamError, ProviderHttpError } from '../providers/internal/http';
import type {
  AgentEvent,
  AssistantMessage,
  AssistantMessageEvent,
  Message,
  Model,
  StreamOptions,
} from '../core/types';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';

const TEST_MODEL: Model = {
  id: 'test-model',
  name: 'Test',
  provider: 'test',
  api: 'openai-completions',
  contextWindow: 128000,
  maxTokens: 4096,
  reasoning: false,
  vision: false,
};

const TEST_REQUEST_PLAN = createTestRequestPlan({
  providerId: 'test',
  adapterId: 'openai-compatible',
  catalogRevision: 'test-catalog',
  routeRevision: 'test-route',
  selectedModelId: TEST_MODEL.id,
  effectiveModelId: TEST_MODEL.id,
  appliedBindingIds: [],
  route: {
    protocol: 'OpenAICompatibleChatCompletions',
    baseUrl: 'https://example.test',
    source: 'catalog',
  },
  headers: {},
  bodyPatch: {},
    contextBudgetTokens: TEST_MODEL.contextWindow,
    contextMode: 'normal',
    contextWindowTokens: TEST_MODEL.contextWindow,
  activeTierId: 'default',
  fastMode: false,
  reasoningWire: {
    selection: 'off',
    control: {
      kind: 'none',
      supportsOff: true,
      levels: [],
      defaultSelection: 'off',
      wireProfile: { kind: 'none' },
    },
  },
});

function makeAssistantMessage(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: TEST_MODEL.id,
    provider: TEST_MODEL.provider,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    timestamp: Date.now(),
    stopReason: 'stop',
  };
}

function makeProviderStream(factory: () => Promise<AssistantMessage>): EventStream<AssistantMessageEvent, AssistantMessage> {
  const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
    (event) => event.type === 'done' || event.type === 'error',
    (event) => (event.type === 'done' || event.type === 'error' ? event.message : makeAssistantMessage('')),
  );
  void factory()
    .then((message) => {
      stream.push({ type: 'start', partial: makeAssistantMessage('') });
      stream.push({ type: 'done', reason: 'stop', message });
      stream.complete(message);
    })
    .catch((error: Error) => {
      stream.error(error);
    });
  return stream;
}

describe('AgentLoop recovery diagnostics', () => {
  it('emits started and completed diagnostics when retry succeeds', async () => {
    let attempts = 0;
    const provider: ProviderStrategy = {
      api: 'openai-completions',
      stream: () => {
        attempts += 1;
        if (attempts === 1) {
          const stream = new EventStream<AssistantMessageEvent, AssistantMessage>();
          void Promise.resolve().then(() => {
            stream.error(new Error('429 rate limit exceeded'));
          });
          return stream;
        }
        return makeProviderStream(async () => makeAssistantMessage('ok'));
      },
    };

    const events: AgentEvent[] = [];
    const context: AgentContext = {
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        timestamp: Date.now(),
      }],
    };
    const recovery = new ErrorRecovery({ primaryModel: TEST_MODEL, maxRetries: 3 });

    const { stream } = agentLoop([], context, {
      model: TEST_MODEL,
      convertToLlm: (messages) => messages as Message[],
      errorRecovery: recovery,
      maxTurns: 1,
      streamOptions: { maxTokens: 256, requestPlan: TEST_REQUEST_PLAN } satisfies StreamOptions,
    }, provider);

    for await (const event of stream) {
      events.push(event);
    }

    const diagnostics = events.filter((event) => event.type === 'diagnostic');
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      type: 'diagnostic',
      code: 'error_recovery_retry',
      phase: 'started',
      message: 'provider 错误，正在重试（第 1 次）',
    });
    expect(diagnostics[1]).toMatchObject({
      type: 'diagnostic',
      code: 'error_recovery_retry',
      phase: 'completed',
      message: '错误恢复成功，继续生成回复',
    });
  });

  it('does not emit recovery diagnostics when the first provider call succeeds', async () => {
    const provider: ProviderStrategy = {
      api: 'openai-completions',
      stream: () => makeProviderStream(async () => makeAssistantMessage('ok')),
    };

    const events: AgentEvent[] = [];
    const context: AgentContext = {
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        timestamp: Date.now(),
      }],
    };

    const { stream } = agentLoop([], context, {
      model: TEST_MODEL,
      convertToLlm: (messages) => messages as Message[],
      errorRecovery: new ErrorRecovery({ primaryModel: TEST_MODEL }),
      maxTurns: 1,
      streamOptions: { requestPlan: TEST_REQUEST_PLAN },
    }, provider);

    for await (const event of stream) {
      events.push(event);
    }

    expect(events.some((event) => event.type === 'diagnostic')).toBe(false);
  });

  it('aborts recovery sleep when stream is aborted', async () => {
    let attempts = 0;
    const provider: ProviderStrategy = {
      api: 'openai-completions',
      stream: () => {
        attempts += 1;
        const stream = new EventStream<AssistantMessageEvent, AssistantMessage>();
        void Promise.resolve().then(() => {
          stream.error(new Error('429 rate limit exceeded'));
        });
        return stream;
      },
    };
    const context: AgentContext = {
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        timestamp: Date.now(),
      }],
    };
    const recovery = new ErrorRecovery({ primaryModel: TEST_MODEL, maxRetries: 5 });
    const { stream, producerCompletion } = agentLoop([], context, {
      model: TEST_MODEL,
      convertToLlm: (messages) => messages as Message[],
      errorRecovery: recovery,
      maxTurns: 1,
      streamOptions: { maxTokens: 256, requestPlan: TEST_REQUEST_PLAN } satisfies StreamOptions,
    }, provider);

    // Abort during the long retry backoff.
    setTimeout(() => stream.abort(), 5);
    await expect((async () => {
      for await (const _event of stream) {
        // drain
      }
    })()).rejects.toMatchObject({ name: 'AbortError' });
    await producerCompletion;
    expect(attempts).toBeGreaterThanOrEqual(1);
  });

  it('retains the original ProviderHttpError as cause when server_error retries abort', async () => {
    const original = new ProviderHttpError('openai-responses', 500, 'upstream exploded', '{"error":"boom"}');
    const recovery = new ErrorRecovery({ primaryModel: TEST_MODEL, maxRetries: 3 });
    vi.spyOn(recovery, 'getRetryDelay').mockReturnValue(0);
    let attempts = 0;
    const provider: ProviderStrategy = {
      api: 'openai-completions',
      stream: () => {
        attempts += 1;
        const stream = new EventStream<AssistantMessageEvent, AssistantMessage>();
        void Promise.resolve().then(() => {
          stream.error(original);
        });
        return stream;
      },
    };
    const { stream, producerCompletion } = agentLoop([], {
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        timestamp: Date.now(),
      }],
    }, {
      model: TEST_MODEL,
      convertToLlm: (messages) => messages as Message[],
      errorRecovery: recovery,
      maxTurns: 1,
      streamOptions: { maxTokens: 256, requestPlan: TEST_REQUEST_PLAN } satisfies StreamOptions,
    }, provider);

    const rejected = await (async () => {
      try {
        for await (const _event of stream) {
          // drain
        }
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    await producerCompletion;

    expect(attempts).toBe(4);
    expect(rejected).toBeInstanceOf(AgentRecoveryAbortError);
    expect(rejected).toMatchObject({
      category: 'server_error',
      lastStatus: 500,
      attempts: 4,
      maxAttempts: 4,
    });
    expect((rejected as AgentRecoveryAbortError).cause).toBe(original);
  });

  it('retries empty_stream once then aborts with the original cause', async () => {
    const original = new ProviderEmptyStreamError('openai-responses');
    const recovery = new ErrorRecovery({ primaryModel: TEST_MODEL, maxRetries: 3 });
    vi.spyOn(recovery, 'getRetryDelay').mockReturnValue(0);
    let attempts = 0;
    const provider: ProviderStrategy = {
      api: 'openai-completions',
      stream: () => {
        attempts += 1;
        const stream = new EventStream<AssistantMessageEvent, AssistantMessage>();
        void Promise.resolve().then(() => {
          stream.error(original);
        });
        return stream;
      },
    };
    const { stream, producerCompletion } = agentLoop([], {
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        timestamp: Date.now(),
      }],
    }, {
      model: TEST_MODEL,
      convertToLlm: (messages) => messages as Message[],
      errorRecovery: recovery,
      maxTurns: 1,
      streamOptions: { maxTokens: 256, requestPlan: TEST_REQUEST_PLAN } satisfies StreamOptions,
    }, provider);

    const rejected = await (async () => {
      try {
        for await (const _event of stream) {
          // drain
        }
        return undefined;
      } catch (error) {
        return error;
      }
    })();
    await producerCompletion;

    expect(attempts).toBe(2);
    expect(rejected).toBeInstanceOf(AgentRecoveryAbortError);
    expect(rejected).toMatchObject({
      category: 'empty_stream',
      attempts: 2,
      maxAttempts: 2,
    });
    expect((rejected as AgentRecoveryAbortError).cause).toBe(original);
    expect(rejected).not.toMatchObject({ lastStatus: 502 });
  });
});
