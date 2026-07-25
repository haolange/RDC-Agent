/**
 * Agent LoopRuntimeState COW / revision semantics (Phase 4.2).
 */
import { describe, expect, it } from 'vitest';
import type { Model, ToolDefinition } from '../core/types';
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
});
