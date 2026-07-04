import { describe, expect, it } from 'vitest';
import { createBuiltinProviderEntry } from '@shared/constants/llm';
import type { AppSettings } from '@shared/types/settings';
import {
  resolveEffectiveModelId,
  resolveModelCapability,
  resolveReasoningBudget,
} from './ModelCapabilityResolver';

function makeSettings(overrides: Partial<AppSettings['llm']> = {}): AppSettings {
  const anthropic = createBuiltinProviderEntry('anthropic');
  return {
    appearance: { theme: 'dark', language: 'zh-CN', fontScale: 'medium' },
    layout: {
      leftSidebar: { collapsed: false, width: 280, expandedWidth: 280 },
      rightPanel: { collapsed: false, width: 360, expandedWidth: 360 },
      terminal: { height: 240 },
    },
    profile: { nickname: '' },
    workspace: { rootPath: '' },
    tooling: {
      rdxCli: {
        enabled: false,
        command: '',
        argsPrefix: [],
        workingDirectory: '',
        env: {},
        timeoutMs: 30_000,
        catalogPath: '',
        jsonMode: 'auto',
      },
      rdxActions: {} as AppSettings['tooling']['rdxActions'],
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
    llm: {
      providers: [{
        ...anthropic,
        enabled: true,
        hasStoredSecret: true,
        isConfigured: true,
        status: 'verified',
        capabilities: ['chat', 'tool-calling', 'reasoning'],
        models: [
          {
            id: 'claude-sonnet-4',
            label: 'claude-sonnet-4',
            enabled: true,
            contextWindowTokens: null,
          },
          {
            id: 'claude-sonnet-4-fast',
            label: 'claude-sonnet-4-fast',
            enabled: true,
            contextWindowTokens: null,
          },
        ],
      }],
      agentRoutes: [{
        agentId: 'ask',
        providerId: 'anthropic',
        modelId: 'claude-sonnet-4',
      }],
      ...overrides,
    },
    configuration: {
      activeModeProfileId: 'debugger.default',
      availableModeProfiles: [],
      enabledMcpServerIds: [],
      modePatternBindings: {},
      availablePatterns: [],
      availableSkills: [],
      availableMcpServers: [],
      lastMigrationSummary: [],
      diagnostics: [],
    },
    agents: {
      directoryPath: '',
      definitions: [],
      modelOptions: [],
      globalInstructions: '',
    },
    paths: {
      workspaceRoot: '',
      defaultWorkspaceRoot: '',
      settingsPath: '',
      logsPath: '',
      logPath: '',
      projectsPath: '',
      knowledgePath: '',
      migrationOrphansPath: '',
      profilesPath: '',
      policiesPath: '',
      skillsPath: '',
      mcpPath: '',
      patternsPath: '',
      secretsPath: '',
      migrationReportsPath: '',
    },
  };
}

describe('resolveModelCapability', () => {
  it('uses seed catalog when no override exists', () => {
    const capability = resolveModelCapability('anthropic', 'claude-sonnet-4', makeSettings());
    expect(capability.nominalContextWindowTokens).toBe(200_000);
    expect(capability.supportedEffortLevels).toEqual(['low', 'medium', 'high', 'extra', 'max']);
    expect(capability.defaultContextWindowTokens).toBe(200_000);
    expect(capability.maxContextAvailable).toBe(false);
    expect(capability.maxContextWindowTokens).toBeNull();
  });

  it('prefers user override over seed', () => {
    const settings = makeSettings({
      providers: [{
        ...makeSettings().llm.providers[0],
        models: [{
          id: 'claude-sonnet-4',
          label: 'claude-sonnet-4',
          enabled: true,
          contextWindowTokens: null,
          capabilityOverride: {
            nominalContextWindowTokens: 300_000,
            supportedEffortLevels: ['low', 'high'],
            fastVariantModelId: 'claude-sonnet-4-fast',
          },
        }, {
          id: 'claude-sonnet-4-fast',
          label: 'claude-sonnet-4-fast',
          enabled: true,
          contextWindowTokens: null,
        }],
      }],
    });
    const capability = resolveModelCapability('anthropic', 'claude-sonnet-4', settings);
    expect(capability.nominalContextWindowTokens).toBe(300_000);
    expect(capability.supportedEffortLevels).toEqual(['low', 'high']);
    expect(capability.fastVariantModelId).toBe('claude-sonnet-4-fast');
    expect(capability.fastModelAvailable).toBe(true);
  });

  it('returns conservative defaults for unknown models', () => {
    const settings = makeSettings({
      providers: [{
        ...makeSettings().llm.providers[0],
        models: [{
          id: 'unknown-model',
          label: 'unknown-model',
          enabled: true,
          contextWindowTokens: null,
        }],
      }],
    });
    const capability = resolveModelCapability('anthropic', 'unknown-model', settings);
    expect(capability.nominalContextWindowTokens).toBeNull();
    expect(capability.defaultContextWindowTokens).toBe(256_000);
    expect(capability.supportedEffortLevels).toEqual(['low', 'medium', 'high']);
    expect(capability.maxContextAvailable).toBe(false);
    expect(capability.fastModelAvailable).toBe(false);
  });

  it('clears effort levels when provider lacks reasoning capability', () => {
    const settings = makeSettings({
      providers: [{
        ...makeSettings().llm.providers[0],
        capabilities: ['chat', 'tool-calling'],
      }],
    });
    const capability = resolveModelCapability('anthropic', 'claude-sonnet-4', settings);
    expect(capability.supportedEffortLevels).toEqual([]);
    expect(capability.defaultEffort).toBe('medium');
  });

  it('enables max context only when nominal exceeds 256k', () => {
    const settings = makeSettings({
      providers: [{
        ...makeSettings().llm.providers[0],
        models: [{
          id: 'gpt-4.1',
          label: 'gpt-4.1',
          enabled: true,
          contextWindowTokens: null,
        }],
      }],
    });
    const capability = resolveModelCapability('anthropic', 'gpt-4.1', settings);
    expect(capability.nominalContextWindowTokens).toBe(1_047_576);
    expect(capability.maxContextAvailable).toBe(true);
    expect(capability.maxContextWindowTokens).toBe(1_047_576);
    expect(capability.defaultContextWindowTokens).toBe(256_000);
  });

  it('marks fast variant unavailable when not in enabled models', () => {
    const settings = makeSettings({
      providers: [{
        ...makeSettings().llm.providers[0],
        models: [{
          id: 'claude-sonnet-4',
          label: 'claude-sonnet-4',
          enabled: true,
          contextWindowTokens: null,
          capabilityOverride: {
            fastVariantModelId: 'missing-fast-model',
          },
        }],
      }],
    });
    const capability = resolveModelCapability('anthropic', 'claude-sonnet-4', settings);
    expect(capability.fastVariantModelId).toBe('missing-fast-model');
    expect(capability.fastModelAvailable).toBe(false);
  });
});

describe('resolveEffectiveModelId', () => {
  it('switches to fast variant when requested and available', () => {
    const capability = resolveModelCapability('anthropic', 'claude-sonnet-4', makeSettings({
      providers: [{
        ...makeSettings().llm.providers[0],
        models: [{
          id: 'claude-sonnet-4',
          label: 'claude-sonnet-4',
          enabled: true,
          contextWindowTokens: null,
          capabilityOverride: { fastVariantModelId: 'claude-sonnet-4-fast' },
        }, {
          id: 'claude-sonnet-4-fast',
          label: 'claude-sonnet-4-fast',
          enabled: true,
          contextWindowTokens: null,
        }],
      }],
    }));
    expect(resolveEffectiveModelId(capability, {
      effort: 'medium',
      maxContextMode: false,
      fastModel: true,
    })).toBe('claude-sonnet-4-fast');
  });
});

describe('resolveReasoningBudget', () => {
  it('clamps unsupported effort to nearest supported level', () => {
    const capability = resolveModelCapability('anthropic', 'claude-sonnet-4', makeSettings({
      providers: [{
        ...makeSettings().llm.providers[0],
        models: [{
          id: 'claude-sonnet-4',
          label: 'claude-sonnet-4',
          enabled: true,
          contextWindowTokens: null,
          capabilityOverride: { supportedEffortLevels: ['low', 'high'] },
        }],
      }],
    }));
    expect(resolveReasoningBudget(capability, {
      effort: 'max',
      maxContextMode: false,
      fastModel: false,
    })).toBe('high');
  });

  it('returns auto when effort is unavailable', () => {
    const capability = resolveModelCapability('anthropic', 'gpt-4.1', makeSettings({
      providers: [{
        ...makeSettings().llm.providers[0],
        models: [{
          id: 'gpt-4.1',
          label: 'gpt-4.1',
          enabled: true,
          contextWindowTokens: null,
        }],
      }],
    }));
    expect(resolveReasoningBudget(capability, {
      effort: 'medium',
      maxContextMode: false,
      fastModel: false,
    })).toBe('auto');
  });
});
