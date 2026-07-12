import { describe, expect, it } from 'vitest';
import { createBuiltinProviderEntry } from '@shared/constants/llm';
import type { AppSettings, LlmProviderEntry } from '@shared/types/settings';
import {
  resolveEffectiveModelId,
  resolveEffectiveTemperature,
  resolveModelCapability,
  resolveReasoningSelection,
  resolveTurnControls,
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
    appearance: { theme: 'dark', language: 'zh-CN', fontScale: 'medium', composerMarkdown: false, usePointerCursors: false, contextBreakdownExpanded: false },
    layout: {
      leftSidebar: { collapsed: false, width: 280, expandedWidth: 280 },
      rightPanel: { collapsed: false, width: 360, expandedWidth: 360 },
      terminal: { height: 240 },
    },
    profile: { nickname: '' },
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
    resourceCatalog: {
      availableSkills: [],
      availableMcpServers: [],
      diagnostics: [],
    },
    agents: {
      directoryPath: '',
      definitions: [],
      modelOptions: [],
      globalInstructions: '',
    },
    paths: {
      userRdxRoot: '',
      settingsPath: '',
      instructionsPath: '',
      agentsPath: '',
      profileStatePath: '',
      logsPath: '',
      logPath: '',
      projectsPath: '',
      knowledgePath: '',
      policiesPath: '',
      skillsPath: '',
      mcpPath: '',
      secretsPath: '',
    },
  };
}

describe('resolveModelCapability', () => {
  it('uses the provider-aware app-managed catalog', () => {
    const provider = makeProvider(createBuiltinProviderEntry('anthropic'));
    const capability = resolveModelCapability('anthropic', 'claude-sonnet-5', makeSettings(provider));

    expect(capability.catalogSource).toBe('managed-catalog');
    expect(capability.nominalContextWindowTokens).toBe(1_000_000);
    expect(capability.reasoningControl).toMatchObject({
      kind: 'levels',
      supportsOff: true,
      levels: ['low', 'medium', 'high', 'extra', 'max'],
      defaultSelection: 'high',
    });
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
    expect(capability.reasoningControl).toMatchObject({
      kind: 'none',
      defaultSelection: 'off',
    });
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
    expect(capability.reasoningControl.kind).toBe('none');
  });

  it('drives provider/model variants from the managed catalog', () => {
    const openAiProvider = makeProvider(createBuiltinProviderEntry('openai'));
    const openAi56 = resolveModelCapability('openai', 'gpt-5.6-sol', makeSettings(openAiProvider));
    expect(openAi56.reasoningControl).toMatchObject({
      kind: 'levels',
      supportsOff: true,
      levels: ['low', 'medium', 'high', 'extra', 'max'],
      defaultSelection: 'medium',
    });
    expect(openAi56.maxContextAvailable).toBe(true);

    const openAi = resolveModelCapability('openai', 'gpt-5.5', makeSettings(openAiProvider));
    expect(openAi.reasoningControl).toMatchObject({
      kind: 'levels',
      supportsOff: true,
      levels: ['low', 'medium', 'high', 'extra'],
      defaultSelection: 'medium',
    });

    const grokProvider = makeProvider(createBuiltinProviderEntry('xai'));
    const grok45 = resolveModelCapability('xai', 'grok-4.5', makeSettings(grokProvider));
    expect(grok45.reasoningControl).toMatchObject({
      kind: 'levels',
      supportsOff: false,
      levels: ['low', 'medium', 'high'],
      defaultSelection: 'high',
    });
    expect(grok45.maxContextAvailable).toBe(false);

    const qwenProvider = makeProvider(createBuiltinProviderEntry('qwen'));
    const qwen = resolveModelCapability('qwen', 'qwen-plus', makeSettings(qwenProvider));
    expect(qwen.reasoningControl).toMatchObject({
      kind: 'levels',
      supportsOff: true,
      levels: ['minimal', 'low', 'medium', 'high'],
      defaultSelection: 'off',
    });

    const deepSeekProvider = makeProvider(createBuiltinProviderEntry('deepseek'));
    const deepSeek = resolveModelCapability('deepseek', 'deepseek-v4-pro', makeSettings(deepSeekProvider));
    expect(deepSeek.reasoningControl).toMatchObject({
      kind: 'levels',
      supportsOff: true,
      levels: ['high', 'max'],
      defaultSelection: 'high',
    });
  });

  it('exposes Kimi Coding Plan HighSpeed via fastVariantModelId when enabled', () => {
    const provider = makeProvider(createBuiltinProviderEntry('kimi-coding-plan'));
    const capability = resolveModelCapability('kimi-coding-plan', 'kimi-for-coding', makeSettings(provider));

    expect(provider.models.map((model) => model.id)).toEqual([
      'kimi-for-coding',
      'kimi-for-coding-highspeed',
    ]);
    expect(capability.reasoningControl).toMatchObject({
      kind: 'toggle',
      supportsOff: true,
      defaultSelection: 'on',
    });
    expect(capability.maxContextAvailable).toBe(false);
    expect(capability.maxContextWindowTokens).toBeNull();
    expect(capability.fastVariantModelId).toBe('kimi-for-coding-highspeed');
    expect(capability.fastModelAvailable).toBe(true);
    expect(capability.fixedTemperature).toBe(1);
    expect(resolveEffectiveTemperature(capability, 0.35)).toBe(1);
    expect(resolveEffectiveTemperature(capability, 0.7)).toBe(1);
    expect(resolveEffectiveModelId(capability, {
      reasoningLevel: 'on',
      maxContextMode: false,
      fastModel: true,
    })).toBe('kimi-for-coding-highspeed');
  });

  it('exposes fast variant only when the catalog variant is enabled', () => {
    const provider = makeProvider(createBuiltinProviderEntry('moonshot'));
    const capability = resolveModelCapability('moonshot', 'kimi-k2.7-code', makeSettings(provider));

    expect(capability.fastVariantModelId).toBe('kimi-k2.7-code-highspeed');
    expect(capability.fastModelAvailable).toBe(true);
    expect(resolveEffectiveModelId(capability, {
      reasoningLevel: 'on',
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

describe('resolveReasoningSelection', () => {
  it('clamps unsupported level to toggle On for binary models', () => {
    const provider = makeProvider(createBuiltinProviderEntry('kimi-coding-plan'));
    const capability = resolveModelCapability('kimi-coding-plan', 'kimi-for-coding', makeSettings(provider));

    expect(resolveReasoningSelection(capability, {
      reasoningLevel: 'max',
      maxContextMode: false,
      fastModel: false,
    })).toEqual({
      selection: 'on',
      control: capability.reasoningControl,
    });
  });

  it('returns off when reasoning is disabled', () => {
    const provider = makeProvider(createBuiltinProviderEntry('openai'));
    const capability = resolveModelCapability('openai', 'gpt-5.5', makeSettings(provider));

    expect(resolveReasoningSelection(capability, {
      reasoningLevel: 'off',
      maxContextMode: false,
      fastModel: false,
    }).selection).toBe('off');
  });

  it('normalizes canonical auto reasoning through the provider capability', () => {
    const kimiProvider = makeProvider(createBuiltinProviderEntry('kimi-coding-plan'));
    const kimiCapability = resolveModelCapability('kimi-coding-plan', 'kimi-for-coding', makeSettings(kimiProvider));
    expect(resolveReasoningSelection(kimiCapability, {
      reasoningLevel: 'auto',
      maxContextMode: false,
      fastModel: false,
    }).selection).toBe('on');
  });

  it('fails closed from unknown reasoning values to the capability default', () => {
    const provider = makeProvider(createBuiltinProviderEntry('openai'));
    const capability = resolveModelCapability('openai', 'gpt-5.3-codex', makeSettings(provider));

    expect(resolveReasoningSelection(capability, {
      reasoningLevel: 'unsupported-value',
      maxContextMode: false,
      fastModel: false,
    }).selection).toBe('medium');
  });
});

describe('resolveTurnControls', () => {
  it('normalizes session turn controls through the capability truth', () => {
    const provider = makeProvider(createBuiltinProviderEntry('qwen'));
    const capability = resolveModelCapability('qwen', 'qwen-plus', makeSettings(provider));

    expect(resolveTurnControls(capability, undefined, {
      reasoningLevel: 'auto',
      maxContextMode: true,
      fastModel: true,
    })).toEqual({
      reasoningLevel: 'minimal',
      maxContextMode: true,
      fastModel: true,
    });
  });
});
