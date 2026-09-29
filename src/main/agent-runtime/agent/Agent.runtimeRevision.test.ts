/**
 * Agent LoopRuntimeState COW / revision semantics (Phase 4.2).
 */
import { describe, expect, it } from 'vitest';
import type { AssistantMessage, AssistantMessageEvent, Context, Message, Model, ToolDefinition } from '../core/types';
import { EventStream } from '../core/EventStream';
import { __testing as responsesWire } from '../providers/OpenAIResponsesProvider';
import { Agent } from './Agent';
import { createTestRequestPlan } from '../../testing/createTestRequestPlan';

const model: Model = {
  id: 'test-model',
  name: 'Test',
  provider: 'test',
  api: 'openai-completions',
  contextWindow: 128000,
  maxTokens: 4096,
  reasoning: false,
  vision: false,
};

const streamOptions = {
  requestPlan: createTestRequestPlan({
    providerId: 'test',
    adapterId: 'openai-compatible',
    catalogRevision: 'test-catalog',
    routeRevision: 'test-route',
    selectedModelId: model.id,
    effectiveModelId: model.id,
    appliedBindingIds: [],
    route: {
      protocol: 'OpenAICompatibleChatCompletions',
      baseUrl: 'https://example.test',
      source: 'catalog',
    },
    headers: {},
    bodyPatch: {},
    contextBudgetTokens: 1000,
    contextMode: 'normal',
    contextWindowTokens: 2000,
    activeTierId: 'normal',
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
  }),
};

const tool = (name: string): ToolDefinition => ({
  name,
  description: name,
  parameters: { type: 'object', properties: {} },
});

const unusedProvider = {
  stream: () => {
    throw new Error('unused');
  },
} as never;

describe('Agent LoopRuntimeState', () => {
  it('delivers a native tool image through the default Agent path to Responses input', async () => {
    let request: Context | undefined;
    const completed: AssistantMessage = {
      role: 'assistant', content: [{ type: 'text', text: 'Seen.' }],
      model: model.id, provider: model.provider,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      stopReason: 'stop', timestamp: 4,
    };
    const provider = {
      api: model.api,
      stream: (_model: Model, context: Context) => {
        request = context;
        const stream = new EventStream<AssistantMessageEvent, AssistantMessage>(
          event => event.type === 'done',
          event => (event as Extract<AssistantMessageEvent, { type: 'done' }>).message,
        );
        queueMicrotask(() => stream.push({ type: 'done', reason: 'stop', message: completed }));
        return stream;
      },
    };
    const agent = new Agent({
      initialState: {
        model, tools: [], messages: [
          { role: 'user', content: 'Inspect the exported frame.', timestamp: 1 },
          {
            role: 'assistant', content: [{ type: 'toolCall', id: 'image-call', name: 'read_image', arguments: {} }],
            model: model.id, provider: model.provider,
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            stopReason: 'toolUse', timestamp: 2,
          },
          {
            role: 'toolResult', toolCallId: 'image-call', toolName: 'read_image',
            content: [
              { type: 'text', text: 'frame export' },
              { type: 'image', mimeType: 'image/png', data: 'YWJj' },
            ],
            isError: false, timestamp: 3,
          },
        ],
      },
      provider, streamOptions,
    });

    await agent.prompt('Describe visible evidence only.');
    expect(request).toBeDefined();
    const wire = responsesWire.toResponsesInput(request!, streamOptions.requestPlan) as Array<Record<string, unknown>>;
    const output = wire.find(item => item.type === 'function_call_output' && item.call_id === 'image-call');
    expect(output?.output).toContain('frame export');
    const imageMessage = wire.find(item => item.role === 'user' && Array.isArray(item.content)
      && (item.content as Array<{ type: string }>).some(part => part.type === 'input_image'));
    expect(imageMessage).toMatchObject({
      content: expect.arrayContaining([{ type: 'input_image', image_url: 'data:image/png;base64,YWJj' }]),
    });
  });

  it('setTools uses COW and bumps revision without splicing shared array', () => {
    const agent = new Agent({
      initialState: { model, tools: [tool('a'), tool('b')], messages: [] },
      provider: unusedProvider,
      streamOptions,
    });

    const before = agent.runtimeState;
    expect(before.revision).toBe(1);
    const beforeToolsRef = before.activeTools;

    agent.setTools([tool('a'), tool('c')]);
    const after = agent.runtimeState;
    expect(after.revision).toBe(2);
    expect(after.activeTools.map((t) => t.name)).toEqual(['a', 'c']);
    expect(after.activeTools).not.toBe(beforeToolsRef);
    expect(agent.state.tools?.map((t) => t.name)).toEqual(['a', 'c']);
  });

  it('rehydrateMessages replaces history; clearMessages empties turn buffer', () => {
    const agent = new Agent({
      initialState: {
        model,
        tools: [],
        messages: [{ role: 'user', content: 'old', timestamp: 1 }],
      },
      provider: unusedProvider,
      streamOptions,
    });

    agent.rehydrateMessages([
      { role: 'user', content: 'from-disk', timestamp: 2 },
    ]);
    expect(agent.messages).toHaveLength(1);
    expect((agent.messages[0] as { content: string }).content).toBe('from-disk');

    agent.clearMessages();
    expect(agent.messages).toHaveLength(0);
  });

  it('activateDeferredTools bumps revision and updates activated set', () => {
    const agent = new Agent({
      initialState: { model, tools: [tool('core')], messages: [] },
      provider: unusedProvider,
      streamOptions,
    });
    const activated = new Set(['mcp__x__y']);
    agent.activateDeferredTools(activated, [tool('core'), tool('mcp__x__y')]);
    expect(agent.runtimeState.revision).toBe(2);
    expect([...agent.runtimeState.activatedDeferredTools]).toEqual(['mcp__x__y']);
    expect(agent.runtimeState.activeTools.map((t) => t.name)).toEqual(['core', 'mcp__x__y']);
  });

  it('abortAndJoin waits for the complete active loop promise', async () => {
    const agent = new Agent({
      initialState: { model, tools: [], messages: [] },
      provider: unusedProvider,
      streamOptions,
    });
    let release!: (messages: Message[]) => void;
    const activeLoopPromise = new Promise<Message[]>((resolve) => {
      release = resolve;
    });
    (agent as unknown as { _activeLoopPromise: Promise<Message[]> })._activeLoopPromise = activeLoopPromise;

    let joined = false;
    const joinPromise = agent.abortAndJoin().then(() => {
      joined = true;
    });
    await Promise.resolve();
    expect(joined).toBe(false);

    release([]);
    await joinPromise;
    expect(joined).toBe(true);
  });

  it('abortAndJoin waits for producerCompletion even if loop promise settles first', async () => {
    const agent = new Agent({
      initialState: { model, tools: [], messages: [] },
      provider: unusedProvider,
      streamOptions,
    });
    let releaseProducer!: () => void;
    const producerCompletion = new Promise<void>((resolve) => {
      releaseProducer = resolve;
    });
    (agent as unknown as { _activeLoopPromise: Promise<Message[]> })._activeLoopPromise = Promise.resolve([]);
    (agent as unknown as { _activeProducerCompletion: Promise<void> })._activeProducerCompletion = producerCompletion;

    let joined = false;
    const joinPromise = agent.abortAndJoin().then(() => {
      joined = true;
    });
    await Promise.resolve();
    expect(joined).toBe(false);
    releaseProducer();
    await joinPromise;
    expect(joined).toBe(true);
  });
});
