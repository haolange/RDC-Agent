import { describe, expect, it } from 'vitest';
import { createBuiltinProviderEntry } from '@shared/constants/llm';
import type { AppSettings, LlmProviderEntry } from '@shared/types/settings';
import {
  resolveEffectiveModelId,
  resolveModelCapability,
  resolveReasoningBudget,
} from './ModelCapabilityResolver';

function makeProvider(provider: LlmProviderEntry): LlmProviderEntry {
  return {
    ...provider,
    enabled: true,
    hasStoredSecret: true,
    isConfigured: true,
    status: 'verified',
    models: provider.models.map((model) => ({ ...model })),
  };
}

function makeSettings(provider: LlmProviderEntry): AppSettings {
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
      providers: [provider],
      agentRoutes: [{
        agentId: 'ask',
        providerId: provider.id,
        modelId: provider.models[0]?.id ?? '',
      }],
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
  it('uses the provider-aware app-managed catalog', () => {
    const provider = makeProvider(createBuiltinProviderEntry('anthropic'));
    const capability = resolveModelCapability('anthropic', 'claude-sonnet-5', makeSettings(provider));

    expect(capability.catalogSource).toBe('managed-catalog');
    expect(capability.nominalContextWindowTokens).toBe(1_000_000);
    expect(capability.reasoningMode).toBe('effort-levels');
    expect(capability.supportedReasoningLevels).toEqual(['off', 'auto', 'low', 'medium', 'high']);
    expect(capability.defaultReasoningLevel).toBe('auto');
    expect(capability.defaultContextWindowTokens).toBe(256_000);
    expect(capability.maxContextAvailable).toBe(true);
    expect(capability.maxContextWindowTokens).toBe(1_000_000);
    expect(capability.toolCalling).toBe(true);
    expect(capability.visionInput).toBe(true);
    expect(capability.structuredOutput).toBe(true);
  });

  it('returns conservative defaults for unknown app-managed models', () => {
    const provider = makeProvider({
      ...createBuiltinProviderEntry('anthropic'),
      models: [{ id: 'unknown-model', label: 'unknown-model', enabled: true }],
    });
    const capability = resolveModelCapability('anthropic', 'unknown-model', makeSettings(provider));

    expect(capability.catalogSource).toBe('conservative-default');
    expect(capability.nominalContextWindowTokens).toBeNull();
    expect(capability.defaultContextWindowTokens).toBe(256_000);
    expect(capability.reasoningMode).toBe('none');
    expect(capability.supportedReasoningLevels).toEqual(['off']);
    expect(capability.defaultReasoningLevel).toBe('off');
    expect(capability.maxContextAvailable).toBe(false);
    expect(capability.fastModelAvailable).toBe(false);
  });

  it('does not apply app-managed capabilities to user-managed providers', () => {
    const provider = makeProvider({
      ...createBuiltinProviderEntry('openrouter'),
      models: [{ id: 'claude-sonnet-5', label: 'claude-sonnet-5', enabled: true }],
    });
    const capability = resolveModelCapability('openrouter', 'claude-sonnet-5', makeSettings(provider));

    expect(provider.catalogOwnership).toBe('user-managed');
    expect(capability.catalogSource).toBe('conservative-default');
    expect(capability.nominalContextWindowTokens).toBeNull();
    expect(capability.supportedReasoningLevels).toEqual(['off']);
  });

  it('drives non-Kimi provider shapes from the managed catalog', () => {
    const openAiProvider = makeProvider(createBuiltinProviderEntry('openai'));
    const openAi = resolveModelCapability('openai', 'gpt-5.5', makeSettings(openAiProvider));
    expect(openAi.reasoningMode).toBe('effort-levels');
    expect(openAi.supportedReasoningLevels).toEqual(['off', 'auto', 'low', 'medium', 'high', 'max']);
    expect(openAi.maxContextAvailable).toBe(true);

    const anthropicProvider = makeProvider(createBuiltinProviderEntry('anthropic'));
    const anthropic = resolveModelCapability('anthropic', 'claude-sonnet-5', makeSettings(anthropicProvider));
    expect(anthropic.reasoningMode).toBe('effort-levels');
    expect(anthropic.supportedReasoningLevels).toEqual(['off', 'auto', 'low', 'medium', 'high']);
    expect(anthropic.maxContextAvailable).toBe(true);

    const qwenProvider = makeProvider(createBuiltinProviderEntry('qwen'));
    const qwen = resolveModelCapability('qwen', 'qwen-plus', makeSettings(qwenProvider));
    expect(qwen.reasoningMode).toBe('auto-only');
    expect(qwen.supportedReasoningLevels).toEqual(['off', 'auto']);
    expect(qwen.maxContextAvailable).toBe(false);

    const deepSeekProvider = makeProvider(createBuiltinProviderEntry('deepseek'));
    const deepSeek = resolveModelCapability('deepseek', 'deepseek-v4-pro', makeSettings(deepSeekProvider));
    expect(deepSeek.reasoningMode).toBe('effort-levels');
    expect(deepSeek.supportedReasoningLevels).toEqual(['off', 'auto', 'low', 'medium', 'high', 'max']);
    expect(deepSeek.maxContextAvailable).toBe(true);

    const codex = resolveModelCapability('openai', 'gpt-5.3-codex', makeSettings(openAiProvider));
    expect(codex.supportedReasoningLevels).toEqual(['off', 'auto', 'low', 'medium', 'high', 'extHigh']);
  });

  it('keeps Kimi Coding Plan as a single auto-only model without fast variant', () => {
    const provider = makeProvider(createBuiltinProviderEntry('kimi-coding-plan'));
    const capability = resolveModelCapability('kimi-coding-plan', 'kimi-for-coding', makeSettings(provider));

    expect(provider.models.map((model) => model.id)).toEqual(['kimi-for-coding']);
    expect(capability.reasoningMode).toBe('auto-only');
    expect(capability.supportedReasoningLevels).toEqual(['off', 'auto']);
    expect(capability.defaultReasoningLevel).toBe('auto');
    expect(capability.maxContextAvailable).toBe(false);
    expect(capability.maxContextWindowTokens).toBeNull();
    expect(capability.fastVariantModelId).toBeNull();
    expect(capability.fastModelAvailable).toBe(false);
  });

  it('exposes fast variant only when the catalog variant is enabled', () => {
    const provider = makeProvider(createBuiltinProviderEntry('moonshot'));
    const capability = resolveModelCapability('moonshot', 'kimi-k2.7-code', makeSettings(provider));

    expect(capability.fastVariantModelId).toBe('kimi-k2.7-code-highspeed');
    expect(capability.fastModelAvailable).toBe(true);
    expect(resolveEffectiveModelId(capability, {
      reasoningLevel: 'medium',
      maxContextMode: false,
      fastModel: true,
    })).toBe('kimi-k2.7-code-highspeed');
  });

  it('marks catalog fast variant unavailable when the variant is disabled', () => {
    const provider = makeProvider({
      ...createBuiltinProviderEntry('moonshot'),
      models: createBuiltinProviderEntry('moonshot').models.map((model) => ({
        ...model,
        enabled: model.id !== 'kimi-k2.7-code-highspeed',
      })),
    });
    const capability = resolveModelCapability('moonshot', 'kimi-k2.7-code', makeSettings(provider));

    expect(capability.fastVariantModelId).toBe('kimi-k2.7-code-highspeed');
    expect(capability.fastModelAvailable).toBe(false);
  });
});

describe('resolveReasoningBudget', () => {
  it('clamps unsupported reasoning level to nearest catalog-supported level', () => {
    const provider = makeProvider(createBuiltinProviderEntry('kimi-coding-plan'));
    const capability = resolveModelCapability('kimi-coding-plan', 'kimi-for-coding', makeSettings(provider));

    expect(resolveReasoningBudget(capability, {
      reasoningLevel: 'max',
      maxContextMode: false,
      fastModel: false,
    })).toBe('auto');
  });

  it('returns off when reasoning is disabled', () => {
    const provider = makeProvider(createBuiltinProviderEntry('openai'));
    const capability = resolveModelCapability('openai', 'gpt-5.5', makeSettings(provider));

    expect(resolveReasoningBudget(capability, {
      reasoningLevel: 'off',
      maxContextMode: false,
      fastModel: false,
    })).toBe('off');
  });

  it('reads legacy effort input into canonical reasoningLevel without writing it back', () => {
    const provider = makeProvider(createBuiltinProviderEntry('openai'));
    const capability = resolveModelCapability('openai', 'gpt-5.5', makeSettings(provider));

    expect(resolveReasoningBudget(capability, {
      effort: 'max',
      maxContextMode: false,
      fastModel: false,
    })).toBe('max');
  });

  it('fails closed from unknown reasoning values to the capability default', () => {
    const provider = makeProvider(createBuiltinProviderEntry('openai'));
    const capability = resolveModelCapability('openai', 'gpt-5.3-codex', makeSettings(provider));

    expect(resolveReasoningBudget(capability, {
      reasoningLevel: 'legacy-effort-level',
      maxContextMode: false,
      fastModel: false,
    })).toBe('auto');
  });
});
