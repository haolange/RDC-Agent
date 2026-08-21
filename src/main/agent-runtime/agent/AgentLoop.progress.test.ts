import { describe, expect, it } from 'vitest';
import { EventStream } from '../core/EventStream';
import type { ProviderStrategy } from '../core/ProviderRegistry';
import type {
  AgentEvent,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Message,
  Model,
  StreamOptions,
  ToolResultMessage,
} from '../core/types';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';
import { agentLoop, type AgentContext } from './AgentLoop';
import {
  AgentLoopTerminationError,
  RUNTIME_NO_PROGRESS_INSTRUCTION,
} from './LoopProgressGuard';

const TEST_MODEL: Model = {
  id: 'test-model',
  name: 'Test model',
  provider: 'test-provider',
  api: 'test-api',
  contextWindow: 128_000,
  maxTokens: 4_096,
  reasoning: false,
  vision: false,
};

const TEST_REQUEST_PLAN = createTestRequestPlan({
  providerId: TEST_MODEL.provider,
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

function toolUseMessage(callIndex: number): AssistantMessage {
  return {
    role: 'assistant',
    content: [{
      type: 'toolCall',
      id: `call-${callIndex}`,
      name: 'task_list',
      arguments: {},
    }],
    model: TEST_MODEL.id,
    provider: TEST_MODEL.provider,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    stopReason: 'toolUse',
    timestamp: Date.now(),
  };
}

function providerStream(message: AssistantMessage): EventStream<AssistantMessageEvent, AssistantMessage> {
  const stream = new EventStream<AssistantMessageEvent, AssistantMessage>();
  void Promise.resolve().then(() => {
    stream.push({ type: 'start', partial: { ...message, content: [] } });
    stream.push({ type: 'done', reason: 'toolUse', message });
    stream.complete(message);
  });
  return stream;
}

function textFromContext(context: Context): string {
  return context.messages.flatMap((message) => {
    if (message.role !== 'user') return [];
    return typeof message.content === 'string'
      ? [message.content]
      : message.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text);
  }).join('\n');
}

async function consume(stream: AsyncIterable<AgentEvent>): Promise<void> {
  for await (const _event of stream) {
    // Drain the complete event stream so terminal errors surface to the caller.
  }
}

function createContext(): AgentContext {
  return {
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: 'Inspect tasks.' }],
      timestamp: Date.now(),
    }],
    runtime: {
      current: {
        revision: 2,
        activeTools: [],
        activatedDeferredTools: new Set<string>(),
      },
    },
  };
}

const toolExecutor = {
  async execute(toolCall: { id: string; name: string }): Promise<ToolResultMessage> {
    return {
      role: 'toolResult',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      content: [{ type: 'text', text: 'No tasks.' }],
      details: { count: 0 },
      isError: false,
      timestamp: Date.now(),
    };
  },
};

describe('AgentLoop progress termination', () => {
  it('injects one ephemeral warning and stops after the third identical tool round', async () => {
    const requestContexts: string[] = [];
    let calls = 0;
    const provider: ProviderStrategy = {
      api: TEST_MODEL.api,
      stream: (_model, context) => {
        requestContexts.push(textFromContext(context));
        calls += 1;
        return providerStream(toolUseMessage(calls));
      },
    };
    const context = createContext();
    const { stream } = agentLoop([], context, {
      model: TEST_MODEL,
      convertToLlm: (messages) => messages as Message[],
      maxTurns: 10,
      streamOptions: { requestPlan: TEST_REQUEST_PLAN } satisfies StreamOptions,
    }, provider, toolExecutor);

    await expect(consume(stream)).rejects.toMatchObject({
      name: 'AgentLoopTerminationError',
      code: 'AGENT_NO_PROGRESS',
      turn: 3,
    } satisfies Partial<AgentLoopTerminationError>);
    expect(calls).toBe(3);
    expect(requestContexts[0]).not.toContain('<runtime_no_progress>');
    expect(requestContexts[1]).not.toContain('<runtime_no_progress>');
    expect(requestContexts[2]).toContain(RUNTIME_NO_PROGRESS_INSTRUCTION);
    expect(JSON.stringify(context.messages)).not.toContain('<runtime_no_progress>');
  });

  it('throws a typed turn-limit error when tool continuation remains pending', async () => {
    let calls = 0;
    const provider: ProviderStrategy = {
      api: TEST_MODEL.api,
      stream: () => {
        calls += 1;
        return providerStream(toolUseMessage(calls));
      },
    };
    const { stream } = agentLoop([], createContext(), {
      model: TEST_MODEL,
      convertToLlm: (messages) => messages as Message[],
      maxTurns: 1,
      streamOptions: { requestPlan: TEST_REQUEST_PLAN },
    }, provider, toolExecutor);

    await expect(consume(stream)).rejects.toMatchObject({
      name: 'AgentLoopTerminationError',
      code: 'AGENT_MAX_TURNS_EXCEEDED',
      turn: 1,
      maxTurns: 1,
    } satisfies Partial<AgentLoopTerminationError>);
    expect(calls).toBe(1);
  });
});

describe('AgentLoop dynamic max tokens', () => {
  function textMessage(): AssistantMessage {
    return {
      role: 'assistant',
      content: [{ type: 'text', text: 'done' }],
      model: TEST_MODEL.id,
      provider: TEST_MODEL.provider,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      stopReason: 'stop',
      timestamp: Date.now(),
    };
  }

  function textStream(message: AssistantMessage): EventStream<AssistantMessageEvent, AssistantMessage> {
    const stream = new EventStream<AssistantMessageEvent, AssistantMessage>();
    void Promise.resolve().then(() => {
      stream.push({ type: 'start', partial: { ...message, content: [] } });
      stream.push({ type: 'done', reason: 'stop', message });
      stream.complete(message);
    });
    return stream;
  }

  it('applies resolveMaxTokens on each provider call', async () => {
    const seen: Array<number | undefined> = [];
    const provider: ProviderStrategy = {
      api: TEST_MODEL.api,
      stream: (_model, _context, options) => {
        seen.push(options.maxTokens);
        return textStream(textMessage());
      },
    };
    const { stream } = agentLoop([], createContext(), {
      model: TEST_MODEL,
      convertToLlm: (messages) => messages as Message[],
      maxTurns: 2,
      streamOptions: { requestPlan: TEST_REQUEST_PLAN },
      resolveMaxTokens: () => 12_345,
    }, provider, toolExecutor);

    await consume(stream);
    expect(seen).toEqual([12_345]);
  });

  it('fails closed when resolveMaxTokens cannot admit any output', async () => {
    let calls = 0;
    const provider: ProviderStrategy = {
      api: TEST_MODEL.api,
      stream: () => {
        calls += 1;
        return textStream(textMessage());
      },
    };
    const { stream } = agentLoop([], createContext(), {
      model: TEST_MODEL,
      convertToLlm: (messages) => messages as Message[],
      maxTurns: 2,
      streamOptions: { requestPlan: TEST_REQUEST_PLAN },
      resolveMaxTokens: () => null,
    }, provider, toolExecutor);

    await expect(consume(stream)).rejects.toThrow(/CONTEXT_CANNOT_FIT/);
    expect(calls).toBe(0);
  });
});
