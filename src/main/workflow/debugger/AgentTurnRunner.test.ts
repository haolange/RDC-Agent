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
      agents: {
        definitions: [
          { id: 'ask', enabled: true, maxTurns: 12 },
          { id: 'debugger', enabled: true },
          { id: 'edit', enabled: true, maxTurns: 0 },
        ],
      },
    }),
  },
}));

import { AgentTurnRunner } from './AgentTurnRunner';
import { TokenizerService } from '../../agent-runtime/core/TokenizerService';
import type { ToolResultMessage } from '../../agent-runtime/core/types';
import type { RequestPlan } from '@shared/types/providerCapability';
import type { AgentSlotRegistry } from './AgentSlotRegistry';
import type { DeferredToolActivationTracker } from './DeferredToolActivationTracker';
import type { HandoffMailbox } from './HandoffMailbox';
import type { McpConnectionCoordinator } from './McpConnectionCoordinator';

function createRunner(): AgentTurnRunner {
  return new AgentTurnRunner({
    slots: {} as AgentSlotRegistry,
    mcp: {} as McpConnectionCoordinator,
    deferredActivation: {} as DeferredToolActivationTracker,
    handoffMailbox: {} as HandoffMailbox,
    tokenizerService: new TokenizerService(),
    sessionTurnKey: (sessionId) => sessionId ?? 'default',
    resolveRuntimeTools: () => ({ toolMap: new Map(), definitions: [], deferredDefinitions: [] }),
    createToolSignature: () => '',
    createToolExecutor: () => ({
      execute: async (): Promise<ToolResultMessage> => ({
        role: 'toolResult',
        toolCallId: '',
        toolName: '',
        content: [],
        isError: false,
        timestamp: 0,
      }),
    }),
  });
}

describe('AgentTurnRunner', () => {
  it('resolveMaxTurns prefers finite policy capped by profile', () => {
    const runner = createRunner();
    expect(runner.resolveMaxTurns('ask', 100)).toBe(12);
    expect(runner.resolveMaxTurns('ask', 5)).toBe(5);
  });

  it('resolveMaxTurns uses profile max when policy omitted', () => {
    const runner = createRunner();
    expect(runner.resolveMaxTurns('ask')).toBe(12);
  });

  it('resolveMaxTurns uses role defaults for execution agents', () => {
    const runner = createRunner();
    expect(runner.resolveMaxTurns('debugger')).toBe(50);
    expect(runner.resolveMaxTurns('edit', 80)).toBe(50);
    expect(runner.resolveMaxTurns('optimizer' as never)).toBe(50);
  });

  it('resolveMaxTurns falls back to 25 for other roles', () => {
    const runner = createRunner();
    expect(runner.resolveMaxTurns('custom' as never)).toBe(25);
  });

  it('getOrCreateAgentSlot requires PromptPlan', () => {
    const runner = createRunner();
    expect(() => runner.getOrCreateAgentSlot(
      'ask',
      'provider',
      'model',
      'system',
      { requestPlan: {} as RequestPlan },
      [],
      undefined,
      '',
      null,
      1000,
      800,
      undefined,
    )).toThrow(/PromptPlan is required/);
  });
});
