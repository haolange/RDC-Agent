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
      paths: {},
      llm: { providers: [], agentRoutes: [] },
      agents: {
        definitions: [{
          id: 'ask',
          enabled: true,
          skills: ['inspect'],
          instructions: 'Ask instructions',
        }],
      },
      agentRuntime: {
        permissions: {
          mode: 'default',
          readableRoots: [],
          writableRoots: [],
          allowedCommandPrefixes: [],
          deniedCommandPrefixes: [],
        },
      },
    }),
  },
}));

vi.mock('../../settings/AgentManifestService', () => ({
  agentManifestService: {
    getEffectiveProfiles: () => [{
      id: 'ask',
      enabled: true,
      skills: ['inspect'],
      instructions: 'Ask instructions',
    }],
  },
}));

vi.mock('../../settings/AgentRuntimeConfigService', () => ({
  agentRuntimeConfigService: {
    loadSkill: (id: string) => (id === 'inspect'
      ? { id: 'inspect', name: 'inspect', description: 'd', allowedTools: ['read_file'] }
      : null),
    listSkillMetadata: () => [],
  },
}));

vi.mock('../../runtime/ScopedInstructionResolver', () => ({
  scopedInstructionResolver: {
    resolveForPaths: () => ({ sources: [], totalBytes: 0, diagnostics: [] }),
  },
}));

vi.mock('../../runtime/AppPathService', () => ({
  appPathService: {
    getUserRdxPaths: () => ({
      instructionsPath: 'D:/user/instructions',
      hooksPath: 'D:/user/hooks',
    }),
    getRuntimePaths: () => ({
      appStateRoot: process.env.TEMP ?? process.cwd(),
    }),
    getAppPath: () => process.cwd(),
  },
}));

vi.mock('../../agent-runtime/prompt', () => ({
  promptPlanBuilder: {
    build: (input: { profile: { id: string }; tools: string[] }) => ({
      id: 'prompt-plan',
      segments: [],
      systemPrompt: `built:${input.profile.id}`,
      totalTokenEstimate: 10,
      tools: input.tools,
      stablePrefix: {
        fingerprint: 'fp',
        segmentIds: [],
        sourceHashes: [],
        tokenEstimate: 0,
        volatileSegmentIds: [],
      },
      metrics: { systemPrompt: 10, scopedInstructions: 0, skills: 0 },
      diagnostics: [],
    }),
  },
  resolvePromptClock: () => ({ currentDate: '2026-07-25', timeZone: 'UTC' }),
}));

vi.mock('../../agent-runtime/capabilities/RouteCapabilityResolver', () => ({
  resolveAgentRouteCapability: () => ({
    providerId: 'p',
    modelId: 'm',
    toolCallingMode: 'native-structured',
    reasoningVisibility: 'none',
    reasoningDelivery: 'none',
    supportsStreaming: true,
    supportsToolResults: true,
    toolCallingUnverified: false,
    visionInputMode: 'disabled',
    structuredOutputMode: 'native',
  }),
}));

import { PromptPlanForTurn } from './PromptPlanForTurn';

describe('PromptPlanForTurn', () => {
  const service = new PromptPlanForTurn();

  it('systemPromptForAgent prefers explicit prompt', () => {
    expect(service.systemPromptForAgent('ask', 'custom')).toBe('custom');
  });

  it('systemPromptForAgent uses top-level display names', () => {
    expect(service.systemPromptForAgent('ask')).toMatch(/Ask/i);
  });

  it('systemPromptForAgent falls back for custom roles', () => {
    expect(service.systemPromptForAgent('custom-role' as never)).toMatch(/custom-role/);
  });

  it('buildPromptPlanForAgentTurn returns null when profile missing', () => {
    const plan = service.buildPromptPlanForAgentTurn({
      agentId: 'missing' as never,
      projectRootPath: null,
      providerId: 'p',
      modelId: 'm',
      toolAllowlist: ['read_file'],
      contextWindowTokens: 1000,
      capability: {
        providerId: 'p',
        modelId: 'm',
        label: 'M',
        aliases: [],
        enabled: true,
        route: { protocol: 'OpenAIResponses', baseUrl: 'https://example.test', source: 'catalog' },
        availability: 'available',
        presencePolicy: 'maintained',
        contextTiers: [],
        defaultBudgetTokens: 1000,
        controls: {
          fast: { state: 'unsupported', fixedValue: false },
          context1m: { state: 'unsupported', fixedValue: false },
          reasoning: {
            kind: 'none',
            supportsOff: true,
            levels: [],
            defaultSelection: 'off',
            wireProfile: { kind: 'none' },
          },
        },
        toolCalling: { state: 'supported' },
        visionInput: { state: 'unsupported' },
        structuredOutput: { state: 'supported' },
        provenance: [],
      },
    });
    expect(plan).toBeNull();
  });

  it('buildPromptPlanForAgentTurn uses frozen effectivePlan allowlist', () => {
    const plan = service.buildPromptPlanForAgentTurn({
      agentId: 'ask',
      projectRootPath: 'D:/Project',
      providerId: 'p',
      modelId: 'm',
      toolAllowlist: ['bash'],
      contextWindowTokens: 1000,
      capability: {
        providerId: 'p',
        modelId: 'm',
        label: 'M',
        aliases: [],
        enabled: true,
        route: { protocol: 'OpenAIResponses', baseUrl: 'https://example.test', source: 'catalog' },
        availability: 'available',
        presencePolicy: 'maintained',
        contextTiers: [],
        defaultBudgetTokens: 1000,
        controls: {
          fast: { state: 'unsupported', fixedValue: false },
          context1m: { state: 'unsupported', fixedValue: false },
          reasoning: {
            kind: 'none',
            supportsOff: true,
            levels: [],
            defaultSelection: 'off',
            wireProfile: { kind: 'none' },
          },
        },
        toolCalling: { state: 'supported' },
        visionInput: { state: 'unsupported' },
        structuredOutput: { state: 'supported' },
        provenance: [],
      },
      effectivePlan: {
        permissionSettings: {
          mode: 'default',
          readableRoots: [],
          writableRoots: [],
          allowedCommandPrefixes: [],
          deniedCommandPrefixes: [],
        },
        profileSkills: ['inspect'],
        toolAllowlist: ['read_file'],
        projectRootPath: 'D:/Project',
      },
    });
    expect(plan).toMatchObject({ systemPrompt: 'built:ask' });
    expect((plan as { tools?: string[] }).tools).toEqual(['read_file']);
  });

  it('buildPromptPlanForAgentTurn fails closed on missing skill', () => {
    expect(() => service.buildPromptPlanForAgentTurn({
      agentId: 'ask',
      projectRootPath: null,
      providerId: 'p',
      modelId: 'm',
      toolAllowlist: ['read_file'],
      contextWindowTokens: 1000,
      capability: {
        providerId: 'p',
        modelId: 'm',
        label: 'M',
        aliases: [],
        enabled: true,
        route: { protocol: 'OpenAIResponses', baseUrl: 'https://example.test', source: 'catalog' },
        availability: 'available',
        presencePolicy: 'maintained',
        contextTiers: [],
        defaultBudgetTokens: 1000,
        controls: {
          fast: { state: 'unsupported', fixedValue: false },
          context1m: { state: 'unsupported', fixedValue: false },
          reasoning: {
            kind: 'none',
            supportsOff: true,
            levels: [],
            defaultSelection: 'off',
            wireProfile: { kind: 'none' },
          },
        },
        toolCalling: { state: 'supported' },
        visionInput: { state: 'unsupported' },
        structuredOutput: { state: 'supported' },
        provenance: [],
      },
      preloadSkillIds: ['missing-skill'],
    })).toThrow(/SKILL_UNAVAILABLE/);
  });
});
