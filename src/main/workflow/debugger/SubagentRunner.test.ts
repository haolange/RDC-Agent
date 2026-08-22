import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.TEMP ?? process.env.TMP ?? process.cwd(),
    getAppPath: () => process.cwd(),
  },
}));

vi.mock('../../settings/SettingsService', () => ({
  settingsService: {
    getAll: () => ({
      agents: { definitions: [] },
      paths: { userRdxRoot: 'C:/tmp/rdc-agent-test', projectRdxRoot: 'C:/tmp/rdc-agent-test/projects' },
      llm: { providers: [], agentRoutes: [] },
    }),
  },
}));

vi.mock('../../settings/AgentManifestService', () => ({
  agentManifestService: {
    getEffectiveProfiles: () => [
      { id: 'ask', enabled: true, instructions: 'Ask profile instructions', tools: [], skills: [], mcpServers: [], handoffs: [] },
    ],
  },
}));

vi.mock('../../settings/EffectiveModelResolver', () => ({
  resolveEffectiveModel: (providerId: string, modelId: string) => {
    if (providerId === 'openai' && modelId === 'gpt-5.6-sol') {
      return {
        providerId,
        modelId,
        enabled: true,
        availability: 'available',
        selection: { pickerVisibility: 'primary' },
      };
    }
    return null;
  },
}));

import { SubagentRunner } from './SubagentRunner';
import { createSubagentBudgetState, type TurnHandle } from './TurnCoordinator';

describe('SubagentRunner', () => {
  it('runSubagent completes and forwards tool/assistant events', async () => {
    const parentEvents: Array<{ type: string }> = [];
    const runner = new SubagentRunner({
      sendProfileMessage: async (_agentId, _content, options) => {
        options?.onEvent?.({
          id: 'e1',
          type: 'assistant.delta',
          timestamp: Date.now(),
          sessionId: 's',
          agentId: 'ask',
          payload: { text: 'partial' },
        });
        options?.onEvent?.({
          id: 'e2',
          type: 'tool.started',
          timestamp: Date.now(),
          sessionId: 's',
          agentId: 'ask',
          payload: { toolCallId: 't1', toolName: 'grep', args: {} },
        });
        options?.onEvent?.({
          id: 'e3',
          type: 'tool.completed',
          timestamp: Date.now(),
          sessionId: 's',
          agentId: 'ask',
          payload: {
            toolCallId: 't1',
            toolName: 'grep',
            result: { ok: true, duration_ms: 1 },
          },
        });
        return 'final answer';
      },
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });

    const parentTurn = {
      subagentBudget: createSubagentBudgetState(),
      signal: undefined,
      generation: 1,
      isLive: () => true,
      registerProducer: () => () => undefined,
      eventSink: { sessionId: 'parent', onEvent: () => undefined },
    } as unknown as TurnHandle;

    const result = await runner.runSubagent({
      parentAgentId: 'debugger',
      parentToolCallId: 'parent-tool',
      targetProfile: 'ask',
      task: 'inspect',
      parentSessionId: 'parent',
      parentOnEvent: (event) => parentEvents.push({ type: event.type }),
      parentTurn,
    });

    expect(result.status).toBe('complete');
    expect(result.text).toBe('final answer');
    expect(parentEvents.some((e) => e.type === 'subagent.started')).toBe(true);
    expect(parentEvents.some((e) => e.type === 'subagent.delta')).toBe(true);
    expect(parentEvents.some((e) => e.type === 'subagent.completed')).toBe(true);
  });

  it('runSubagent marks cancelled when parent already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const runner = new SubagentRunner({
      sendProfileMessage: async () => 'should-not-run',
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    const result = await runner.runSubagent({
      parentAgentId: 'debugger',
      parentToolCallId: 'parent-tool',
      targetProfile: 'ask',
      task: 'inspect',
      signal: controller.signal,
    });
    expect(result.status).toBe('cancelled');
  });

  it('runSubagent marks failed on throw', async () => {
    const runner = new SubagentRunner({
      sendProfileMessage: async () => {
        throw new Error('boom');
      },
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    const result = await runner.runSubagent({
      parentAgentId: 'debugger',
      parentToolCallId: 'parent-tool',
      targetProfile: 'ask',
      task: 'inspect',
    });
    expect(result.status).toBe('failed');
    expect(result.text).toBe('boom');
  });

  it('counts unique toolCallId once across started/completed/denied', async () => {
    const parentBudget = createSubagentBudgetState();
    const runner = new SubagentRunner({
      sendProfileMessage: async (_agentId, _content, options) => {
        options?.onEvent?.({
          id: 'e1', type: 'tool.started', timestamp: Date.now(), sessionId: 's', agentId: 'ask',
          payload: { toolCallId: 'same', toolName: 'grep', args: {} },
        });
        options?.onEvent?.({
          id: 'e2', type: 'tool.completed', timestamp: Date.now(), sessionId: 's', agentId: 'ask',
          payload: { toolCallId: 'same', toolName: 'grep', result: { ok: true, duration_ms: 1 } },
        });
        options?.onEvent?.({
          id: 'e3', type: 'tool.denied', timestamp: Date.now(), sessionId: 's', agentId: 'ask',
          payload: { toolCallId: 'same', toolName: 'grep', reason: 'no' },
        });
        options?.onEvent?.({
          id: 'e4', type: 'tool.started', timestamp: Date.now(), sessionId: 's', agentId: 'ask',
          payload: { toolCallId: 'other', toolName: 'read', args: {} },
        });
        return 'ok';
      },
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    const parentTurn = {
      subagentBudget: parentBudget,
      signal: undefined,
      generation: 1,
      isLive: () => true,
      registerProducer: () => () => undefined,
      eventSink: { sessionId: 'parent', onEvent: () => undefined },
    } as unknown as TurnHandle;
    await runner.runSubagent({
      parentAgentId: 'debugger',
      parentToolCallId: 'parent-tool',
      targetProfile: 'ask',
      task: 'inspect',
      parentSessionId: 'parent',
      parentTurn,
    });
    expect(parentBudget.aggregateToolCalls).toBe(2);
  });

  it('does not inflate aggregateToolCalls for events without toolCallId', async () => {
    const parentBudget = createSubagentBudgetState();
    const runner = new SubagentRunner({
      sendProfileMessage: async (_agentId, _content, options) => {
        options?.onEvent?.({
          id: 'e1', type: 'tool.started', timestamp: Date.now(), sessionId: 's', agentId: 'ask',
          payload: { toolCallId: '', toolName: 'grep', args: {} },
        });
        options?.onEvent?.({
          id: 'e2', type: 'tool.completed', timestamp: Date.now(), sessionId: 's', agentId: 'ask',
          payload: { toolCallId: '   ', toolName: 'grep', result: { ok: true, duration_ms: 1 } },
        });
        options?.onEvent?.({
          id: 'e3', type: 'tool.denied', timestamp: Date.now(), sessionId: 's', agentId: 'ask',
          payload: { toolCallId: '', toolName: 'grep', reason: 'no' },
        });
        return 'ok';
      },
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    const parentTurn = {
      subagentBudget: parentBudget,
      signal: undefined,
      generation: 1,
      isLive: () => true,
      registerProducer: () => () => undefined,
      eventSink: { sessionId: 'parent', onEvent: () => undefined },
    } as unknown as TurnHandle;
    await runner.runSubagent({
      parentAgentId: 'debugger',
      parentToolCallId: 'parent-tool',
      targetProfile: 'ask',
      task: 'inspect',
      parentSessionId: 'parent',
      parentTurn,
    });
    expect(parentBudget.aggregateToolCalls).toBe(0);
  });

  it('createSubagentTools executes delegated run', async () => {
    const runner = new SubagentRunner({
      sendProfileMessage: async () => 'child done',
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    const [tool] = runner.createSubagentTools('debugger', 'sess-1');
    expect(tool.name).toBe('subagent');
    const result = await tool.execute('tc-1', { task: 'do work', profile: 'ask' });
    expect(result.details).toMatchObject({ profile: 'ask', status: 'complete' });
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'child done' });
  });

  it('rejects an invalid model without sending a child turn', async () => {
    const sendProfileMessage = vi.fn(async () => 'should-not-run');
    const runner = new SubagentRunner({
      sendProfileMessage,
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    const result = await runner.runSubagent({
      parentAgentId: 'debugger',
      parentToolCallId: 'parent-tool',
      targetProfile: 'ask',
      task: 'inspect',
      model: 'not-canonical',
    });
    expect(result.status).toBe('failed');
    expect(result.text).toMatch(/MODEL_INVALID/);
    expect(sendProfileMessage).not.toHaveBeenCalled();
  });

  it('forwards a resolved model override and does not inherit a parent session override', async () => {
    const sendProfileMessage = vi.fn(async () => 'child done');
    const runner = new SubagentRunner({
      sendProfileMessage,
      systemPromptForAgent: () => 'fallback',
      getActiveTurn: () => null,
    });
    await runner.runSubagent({
      parentAgentId: 'debugger',
      parentToolCallId: 'parent-tool',
      targetProfile: 'ask',
      task: 'inspect',
      parentSessionId: 'parent',
      model: 'openai:gpt-5.6-sol',
    });
    expect(sendProfileMessage).toHaveBeenCalledWith(
      'ask',
      'inspect',
      expect.objectContaining({
        modelOverride: { providerId: 'openai', modelId: 'gpt-5.6-sol' },
        sessionId: expect.stringContaining('::subagent::'),
      }),
    );
  });
});
