import { describe, expect, it } from 'vitest';
import {
  createBuiltinProviderEntries,
} from '@shared/constants/llm';
import { getManagedProviderModelCatalog } from '@shared/constants/modelCapabilityCatalog';
import type { AppSettings, LlmProviderEntry } from '@shared/types/settings';
import { resolveModelCapability } from './ModelCapabilityResolver';
import {
  createLegacyEquivalentEffectiveModel,
  projectLegacyResolvedCapability,
} from './LegacyCapabilityProjection';

function settingsFor(providers: LlmProviderEntry[]): AppSettings {
  return {
    appearance: { theme: 'dark', language: 'zh-CN', fontScale: 'medium', composerMarkdown: false, usePointerCursors: false, contextBreakdownExpanded: false },
    layout: {
      leftSidebar: { collapsed: false, width: 280, expandedWidth: 280 },
      rightPanel: { collapsed: false, width: 360, expandedWidth: 360 },
      terminal: { height: 240 },
    },
    profile: { nickname: '' },
    tooling: {
      rdxCli: { enabled: false, command: '', argsPrefix: [], workingDirectory: '', env: {}, timeoutMs: 30_000, catalogPath: '', jsonMode: 'auto' },
      rdxActions: {} as AppSettings['tooling']['rdxActions'],
    },
    agentRuntime: { permissions: { mode: 'default', readableRoots: [], writableRoots: [], allowedCommandPrefixes: [], deniedCommandPrefixes: [] } },
    llm: { providers, agentRoutes: [] },
    resourceCatalog: { availableSkills: [], availableMcpServers: [], diagnostics: [] },
    agents: { directoryPath: '', definitions: [], modelOptions: [], globalInstructions: '' },
    paths: {
      userRdxRoot: '', settingsPath: '', instructionsPath: '', agentsPath: '', profileStatePath: '', logsPath: '', logPath: '', projectsPath: '', knowledgePath: '', policiesPath: '', skillsPath: '', mcpPath: '', secretsPath: '',
    },
  };
}

describe('legacy effective capability projection', () => {
  it('matches the old resolver for every bundled provider model and alias', () => {
    const providers = createBuiltinProviderEntries().map((provider) => ({
      ...provider,
      enabled: true,
      status: 'verified' as const,
      isConfigured: true,
      models: provider.models.map((model) => ({ ...model, enabled: true })),
    }));
    const settings = settingsFor(providers);
    let checked = 0;

    for (const provider of providers) {
      const ids = new Set([
        ...provider.models.map((model) => model.id),
        ...getManagedProviderModelCatalog(provider.id).flatMap((entry) => [entry.id, ...(entry.aliases ?? [])]),
        `unknown-${provider.id}`,
      ]);
      for (const modelId of ids) {
        const legacy = resolveModelCapability(provider.id, modelId, settings);
        const effective = createLegacyEquivalentEffectiveModel(provider.id, modelId, settings);
        expect(projectLegacyResolvedCapability(effective), `${provider.id}/${modelId}`).toEqual(legacy);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('preserves disabled fast-variant semantics', () => {
    const provider = {
      ...createBuiltinProviderEntries().find((entry) => entry.id === 'moonshot')!,
      models: createBuiltinProviderEntries().find((entry) => entry.id === 'moonshot')!.models.map((model) => ({
        ...model,
        enabled: model.id !== 'kimi-k2.7-code-highspeed',
      })),
    };
    const settings = settingsFor([provider]);
    const effective = createLegacyEquivalentEffectiveModel('moonshot', 'kimi-k2.7-code', settings);
    expect(projectLegacyResolvedCapability(effective)).toEqual(
      resolveModelCapability('moonshot', 'kimi-k2.7-code', settings),
    );
  });
});
