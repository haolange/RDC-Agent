import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => os.tmpdir(),
    getAppPath: () => process.cwd(),
  },
}));
import { agentManifestService } from './AgentManifestService';
import type { AgentManifestSettings } from '@shared/types/agentManifest';
import type { EffectiveCatalogSnapshot } from '@shared/types/providerCapability';
import type { LlmProviderEntry } from '@shared/types/settings';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('AgentManifestService effective builtin snapshot', () => {
  it('projects provider connection state without confusing derived enabled=false with user disablement', () => {
    const settings = {
      directoryPath: '', definitions: [{ id: 'general', models: ['provider:model'] }],
      modelOptions: [], globalInstructions: '', diagnostics: [],
    } as unknown as AgentManifestSettings;
    const base = {
      id: 'provider', label: 'Provider', catalogOwnership: 'user-managed',
      enabled: false, isConfigured: false, models: [{ id: 'model', enabled: true }],
    } as unknown as LlmProviderEntry;
    const project = (provider: LlmProviderEntry) => agentManifestService
      .projectEffectiveModelOptions(settings, [provider], [], []).modelOptions[0];

    expect(project({ ...base, status: 'unconfigured' })).toMatchObject({
      status: 'provider-unavailable', providerIssue: 'unconfigured',
    });
    expect(project({ ...base, status: 'unconfigured' })).not.toHaveProperty('disabledReason');
    expect(project({ ...base, status: 'failed', lastError: 'HTTP 401: account denied' })).toMatchObject({
      providerIssue: 'failed', disabledReason: 'HTTP 401: account denied',
    });
    expect(project({ ...base, status: 'unavailable', unavailableReason: 'Account route is restricted' })).toMatchObject({
      providerIssue: 'unavailable', disabledReason: 'Account route is restricted',
    });
    expect(project({ ...base, status: 'unconfigured', models: [] })).toMatchObject({
      status: 'provider-unavailable', providerIssue: 'unconfigured',
    });
  });

  it('loads all builtins without creating or changing user resources', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-agent-seeds-'));
    roots.push(root);
    const agentsPath = path.join(root, 'agents');
    const instructionsPath = path.join(root, 'RDC.md');

    const settings = agentManifestService.getSettings(
      { agentsPath, instructionsPath },
      [],
      [],
    );

    expect(fs.existsSync(agentsPath)).toBe(false);

    expect(settings.definitions.map((definition) => definition.id).sort()).toEqual(
      ['analyzer', 'debugger', 'general', 'generator', 'knowledge-scout', 'optimizer', 'pass-analyst', 'pixel-analyst', 'report-writer', 'resource-analyst', 'shader-analyst', 'verifier'],
    );
    expect(settings.definitions.every((definition) => definition.builtin)).toBe(true);
    for (const definition of settings.definitions) {
      expect(definition.tools).not.toContain('todo');
      expect(definition.tools).not.toContain('search_codebase');
      expect(definition.tools).toContain('tool_search');
    }
    const byId = new Map(settings.definitions.map((definition) => [definition.id, definition]));
    for (const id of ['general', 'debugger', 'analyzer', 'optimizer']) expect(byId.get(id)?.tools).toContain('knowledge');
    for (const id of ['generator', 'verifier', 'knowledge-scout', 'report-writer', 'shader-analyst', 'pass-analyst', 'resource-analyst', 'pixel-analyst']) expect(byId.get(id)?.userInvocable).toBe(false);
    expect(byId.get('general')?.tools).toContain('file-manage');
    expect(byId.get('debugger')?.tools).not.toContain('write');
    expect(byId.get('debugger')?.tools).toContain('planArtifact');
  });

  it('projects app-managed choices from EffectiveCatalog and retains only referenced tombstones', () => {
    const provider = {
      id: 'github-copilot',
      label: 'GitHub Copilot',
      protocol: 'OpenAICompatibleChatCompletions',
      catalogOwnership: 'app-managed',
      activeAccountId: 'account-a',
      enabled: true,
      isConfigured: true,
      models: [
        { id: 'claude-sonnet-5', label: 'Persisted Claude', enabled: true },
        { id: 'persisted-only', label: 'Persisted only', enabled: true },
      ],
    } as LlmProviderEntry;
    const definitions = [{
      id: 'edit', models: ['github-copilot/claude-sonnet-5'],
    }] as AgentManifestSettings['definitions'];
    const settings = {
      directoryPath: '', definitions, modelOptions: [], globalInstructions: '', diagnostics: [],
    } satisfies AgentManifestSettings;
    const baseModel = {
      providerId: 'github-copilot', aliases: [], enabled: true,
      route: { protocol: 'OpenAICompatibleChatCompletions' as const, source: 'catalog' as const },
      presencePolicy: 'account-entitled' as const,
      contextTiers: [{ id: 'default', label: 'Default', maxTotalTokens: 200_000, activation: { kind: 'implicit' as const }, entitlement: 'granted' as const }],
      defaultBudgetTokens: 200_000,
      controls: {
        fast: { state: 'unsupported' as const, fixedValue: false },
        maxContext: { state: 'unsupported' as const, fixedValue: false },
        reasoning: { kind: 'unknown' as const, supportsOff: false, levels: [], defaultSelection: 'off' as const, wireProfile: { kind: 'none' as const } },
      },
      selection: { pickerVisibility: 'primary' as const },
      toolCalling: { state: 'supported' as const }, visionInput: { state: 'unknown' as const }, structuredOutput: { state: 'unknown' as const },
      provenance: [],
    };
    const catalog = {
      providerId: 'github-copilot', accountId: 'account-a', protocol: 'OpenAICompatibleChatCompletions', catalogRevision: 'test-catalog',
      scopeGeneration: 'fixture', projectionVersion: 1,
      generatedAt: '2026-07-14T00:00:00.000Z', stale: false, refreshing: false,
      models: [
        { ...baseModel, modelId: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', availability: 'available' as const,
          controls: { ...baseModel.controls, reasoning: { kind: 'levels' as const, supportsOff: false, levels: ['low' as const, 'high' as const],
            defaultSelection: 'high' as const, wireProfile: { kind: 'none' as const } } } },
        { ...baseModel, modelId: 'unknown-tools', label: 'Unknown tools', availability: 'available' as const, toolCalling: { state: 'unknown' as const } },
        {
          ...baseModel,
          modelId: 'claude-opus-4.8-fast',
          label: 'Claude Opus 4.8 Fast',
          availability: 'available' as const,
          selection: { pickerVisibility: 'internal' as const, relatedPrimaryModelIds: ['claude-opus-4.8'] },
        },
        { ...baseModel, modelId: 'claude-sonnet-5', label: 'Claude Sonnet 5', availability: 'unavailable' as const, unavailableReason: 'Not returned by this account.' },
        { ...baseModel, modelId: 'unverified-model', label: 'Unverified', availability: 'unknown' as const },
        { ...baseModel, modelId: 'zero-budget-model', label: 'Zero budget', availability: 'available' as const, defaultBudgetTokens: 0 },
      ],
    } satisfies EffectiveCatalogSnapshot;

    const projected = agentManifestService.projectEffectiveModelOptions(
      settings,
      [provider],
      [{ agentId: 'edit', providerId: 'github-copilot', modelId: 'claude-sonnet-5' }],
      [catalog],
    );
    expect(projected.modelOptions).toEqual([
      expect.objectContaining({ modelId: 'gemini-3.1-pro-preview', configured: true, status: 'ready', reasoningSelections: ['low', 'high'] }),
      expect.objectContaining({ modelId: 'claude-sonnet-5', configured: false, status: 'model-unavailable', disabledReason: 'Not returned by this account.', reasoningSelections: null }),
    ]);
    expect(projected.modelOptions.some((option) => option.modelId === 'persisted-only')).toBe(false);
    expect(projected.modelOptions.some((option) => option.modelId === 'unknown-tools')).toBe(false);
    expect(projected.modelOptions.some((option) => option.modelId === 'unverified-model')).toBe(false);
    expect(projected.modelOptions.some((option) => option.modelId === 'zero-budget-model')).toBe(false);
    expect(projected.modelOptions.some((option) => option.modelId === 'claude-opus-4.8-fast')).toBe(false);
  });

  it('retains a referenced zero-budget primary model only as a disabled diagnostic', () => {
    const provider = {
      id: 'github-copilot', label: 'GitHub Copilot', protocol: 'OpenAICompatibleChatCompletions',
      catalogOwnership: 'app-managed', activeAccountId: 'account-a', enabled: true, isConfigured: true, models: [],
    } as unknown as LlmProviderEntry;
    const settings = {
      directoryPath: '',
      definitions: [{ id: 'edit', models: ['github-copilot/unverified-budget'] }],
      modelOptions: [], globalInstructions: '',
    } as unknown as AgentManifestSettings;
    const catalog = {
      providerId: 'github-copilot', accountId: 'account-a', protocol: 'OpenAICompatibleChatCompletions',
      scopeGeneration: 'fixture', projectionVersion: 1,
      catalogRevision: 'test-catalog', generatedAt: '2026-07-17T00:00:00.000Z', stale: false, refreshing: false,
      models: [{
        providerId: 'github-copilot', modelId: 'unverified-budget', label: 'Unverified budget', aliases: [], enabled: true,
        route: { protocol: 'OpenAICompatibleChatCompletions', source: 'catalog' }, presencePolicy: 'account-entitled',
        availability: 'available', contextTiers: [], defaultBudgetTokens: 0,
        controls: {
          fast: { state: 'unsupported', fixedValue: false }, maxContext: { state: 'unsupported', fixedValue: false },
          reasoning: { kind: 'unknown', supportsOff: false, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
        },
        selection: { pickerVisibility: 'primary' }, toolCalling: { state: 'unknown' }, visionInput: { state: 'unknown' },
        structuredOutput: { state: 'unknown' }, provenance: [],
      }],
    } satisfies EffectiveCatalogSnapshot;

    const projected = agentManifestService.projectEffectiveModelOptions(
      settings,
      [provider],
      [{ agentId: 'edit', providerId: 'github-copilot', modelId: 'unverified-budget' }],
      [catalog],
    );

    expect(projected.modelOptions).toEqual([expect.objectContaining({
      modelId: 'unverified-budget', configured: false, status: 'model-unverified',
      disabledReason: 'Model has no verified positive context budget and cannot be executed safely.',
    })]);
  });

  it('does not synthesize a selector tombstone for a referenced internal target', () => {
    const provider = {
      id: 'kimi-coding-plan',
      label: 'Kimi Coding Plan',
      protocol: 'OpenAICompatibleChatCompletions',
      catalogOwnership: 'app-managed',
      activeAccountId: 'account-a',
      enabled: true,
      isConfigured: true,
      models: [],
    } as unknown as LlmProviderEntry;
    const settings = {
      directoryPath: '',
      definitions: [{ id: 'edit', models: ['kimi-coding-plan/kimi-for-coding-highspeed'] }],
      modelOptions: [],
      globalInstructions: '',
    } as unknown as AgentManifestSettings;
    const catalog = {
      providerId: 'kimi-coding-plan',
      accountId: 'account-a',
      protocol: 'OpenAICompatibleChatCompletions',
      catalogRevision: 'test-catalog',
      scopeGeneration: 'fixture', projectionVersion: 1,
      generatedAt: '2026-07-17T00:00:00.000Z',
      stale: false,
      refreshing: false,
      models: [{
        providerId: 'kimi-coding-plan',
        modelId: 'kimi-for-coding-highspeed',
        label: 'Kimi for Coding Highspeed',
        aliases: [],
        enabled: true,
        route: { protocol: 'OpenAICompatibleChatCompletions', source: 'catalog' },
        presencePolicy: 'maintained',
        availability: 'available',
        contextTiers: [{ id: 'default', label: 'Default', maxTotalTokens: 128_000, activation: { kind: 'implicit' }, entitlement: 'granted' }],
        defaultBudgetTokens: 128_000,
        controls: {
          fast: { state: 'unsupported', fixedValue: false },
          maxContext: { state: 'unsupported', fixedValue: false },
          reasoning: { kind: 'unknown', supportsOff: false, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
        },
        selection: { pickerVisibility: 'internal', relatedPrimaryModelIds: ['kimi-for-coding'] },
        toolCalling: { state: 'unknown' },
        visionInput: { state: 'unknown' },
        structuredOutput: { state: 'unknown' },
        provenance: [],
      }],
    } satisfies EffectiveCatalogSnapshot;

    const projected = agentManifestService.projectEffectiveModelOptions(
      settings,
      [provider],
      [{ agentId: 'edit', providerId: 'kimi-coding-plan', modelId: 'kimi-for-coding-highspeed' }],
      [catalog],
    );

    expect(projected.modelOptions).toEqual([]);
  });

  it('loads catalogs for all configured providers and referenced diagnostics only', () => {
    const provider = (id: string, overrides: Partial<LlmProviderEntry> = {}): LlmProviderEntry => ({
      id,
      label: id,
      protocol: 'OpenAICompatibleChatCompletions',
      catalogOwnership: 'app-managed',
      enabled: true,
      isConfigured: false,
      models: [],
      ...overrides,
    } as unknown as LlmProviderEntry);
    const copilot = provider('github-copilot', { isConfigured: true });
    const referencedDisconnected = provider('referenced-provider');
    const unusedDisconnected = provider('unused-provider');
    const userManaged = provider('custom-provider', {
      catalogOwnership: 'user-managed',
      isConfigured: true,
    });
    const routes = [{
      agentId: 'edit',
      providerId: 'referenced-provider',
      modelId: 'missing-model',
    }];

    expect(agentManifestService.modelOptionCatalogProviderIds(
      [copilot, referencedDisconnected, unusedDisconnected, userManaged],
      routes,
    )).toEqual(['referenced-provider', 'github-copilot', 'custom-provider']);

    expect(agentManifestService.modelOptionCatalogProviderIds(
      [{ ...copilot, isConfigured: false }, unusedDisconnected],
      [],
    )).toEqual([]);
  });

  it('selects a user-managed model only from its current account and protocol catalog', () => {
    const provider = { id: 'local', label: 'Local', protocol: 'OpenAICompatibleChatCompletions',
      catalogOwnership: 'user-managed', enabled: true, isConfigured: true,
      models: [{ id: 'model', label: 'Model', enabled: true }] } as unknown as LlmProviderEntry;
    const settings = { directoryPath: '', definitions: [], modelOptions: [], globalInstructions: '', diagnostics: [] } satisfies AgentManifestSettings;
    const catalog = { providerId: 'local', accountId: 'anonymous:local', protocol: 'OpenAICompatibleChatCompletions',
      catalogRevision: 'revision', scopeGeneration: 'generation', projectionVersion: 1,
      generatedAt: '2026-11-13T00:00:00Z', stale: false, refreshing: false,
      models: [{ providerId: 'local', modelId: 'model', label: 'Model', aliases: [], enabled: true,
        availability: 'available', presencePolicy: 'discovered', defaultBudgetTokens: 128_000,
        route: { protocol: 'OpenAICompatibleChatCompletions', source: 'catalog' }, contextTiers: [],
        controls: { fast: { state: 'unknown', defaultValue: false }, maxContext: { state: 'unsupported', fixedValue: false },
          reasoning: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } } },
        toolCalling: { state: 'supported' }, visionInput: { state: 'unknown' }, structuredOutput: { state: 'unknown' }, provenance: [],
      }] } satisfies EffectiveCatalogSnapshot;
    expect(agentManifestService.projectEffectiveModelOptions(settings, [provider], [], [catalog]).modelOptions)
      .toEqual([expect.objectContaining({ modelId: 'model', status: 'ready' })]);
    expect(agentManifestService.projectEffectiveModelOptions(settings, [provider], [], [{ ...catalog, protocol: 'OpenAIResponses' }]).modelOptions)
      .toEqual([]);
  });

  it('rejects saving general into debugger.agent.md and does not delete debugger', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-agent-filename-'));
    roots.push(root);
    const agentsPath = path.join(root, 'agents');
    const instructionsPath = path.join(root, 'RDC.md');
    await mkdir(agentsPath, { recursive: true });
    const debuggerPath = path.join(agentsPath, 'debugger.agent.md');
    await writeFile(debuggerPath, '---\nname: Debugger\n---\nuser copy\n', 'utf8');
    await expect(agentManifestService.saveDefinition(
      { agentsPath, instructionsPath },
      {
        id: 'general',
        fileName: 'debugger.agent.md',
        name: 'General',
        description: 'x',
        argumentHint: '',
        target: 'rdc-agent',
        models: [],
        icon: 'nodes',
        accent: '#33d1ff',
        disableModelInvocation: false,
        userInvocable: true,
        tools: ['read'],
        skills: [],
        mcpServers: [],
        agents: [],
        handoffs: [],
        metadata: {},
        instructions: 'general',
        enabled: true,
      },
      { scope: 'user' },
    )).rejects.toThrow(/AGENT_MANIFEST_FILENAME_MISMATCH/);
    expect(await readFile(debuggerPath, 'utf8')).toContain('user copy');
    expect(fs.existsSync(path.join(agentsPath, 'general.agent.md'))).toBe(false);
  });

  it('surfaces project invalid candidates as Settings diagnostics without overriding builtin', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-agent-invalid-'));
    roots.push(root);
    const projectRoot = path.join(root, 'project');
    const projectAgents = path.join(projectRoot, '.rdc-agent', 'agents');
    await mkdir(projectAgents, { recursive: true });
    await writeFile(path.join(projectAgents, 'general.agent.md'), 'not a valid manifest\n', 'utf8');
    const settings = agentManifestService.getSettings(
      { agentsPath: path.join(root, 'user-agents'), instructionsPath: path.join(root, 'RDC.md') },
      [],
      [],
      [],
      projectRoot,
    );
    const general = settings.definitions.find((definition) => definition.id === 'general');
    expect(general?.builtin).toBe(true);
    expect(general?.tools).toContain('write');
    expect(settings.diagnostics).toEqual([expect.objectContaining({ code: 'resource.invalid', scope: 'project', agentId: 'general', sourcePath: path.join(projectAgents, 'general.agent.md') })]);
  });

  it('reports four invalid user files once each and preserves a same-id project diagnostic', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-agent-diagnostics-'));
    roots.push(root);
    const agentsPath = path.join(root, 'agents');
    const projectRoot = path.join(root, 'project');
    const projectAgents = path.join(projectRoot, '.rdc-agent', 'agents');
    await mkdir(agentsPath, { recursive: true }); await mkdir(projectAgents, { recursive: true });
    for (const id of ['general', 'debugger', 'analyzer', 'optimizer']) await writeFile(path.join(agentsPath, `${id}.agent.md`), 'invalid user manifest', 'utf8');
    const service = agentManifestService;
    const paths = { agentsPath, instructionsPath: path.join(root, 'RDC.md') };
    expect(service.resolveEffectiveSnapshot(paths).diagnostics).toHaveLength(4);
    await writeFile(path.join(projectAgents, 'general.agent.md'), 'invalid project manifest', 'utf8');
    const result = service.resolveEffectiveSnapshot(paths, projectRoot);
    expect(result.diagnostics).toHaveLength(5);
    expect(result.diagnostics.filter(issue => issue.agentId === 'general').map(issue => issue.scope).sort()).toEqual(['project', 'user']);
    expect(result.profiles).toHaveLength(12);
    expect(result.profiles.every(profile => profile.provenance.scope === 'builtin')).toBe(true);
  });

  it('drops reserved historical ids from effective snapshot and diagnoses both scopes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-agent-reserved-'));
    roots.push(root);
    const agentsPath = path.join(root, 'user-agents');
    const projectAgents = path.join(root, 'project', '.rdc-agent', 'agents');
    await mkdir(agentsPath, { recursive: true });
    await mkdir(projectAgents, { recursive: true });
    await writeFile(path.join(agentsPath, 'ask.agent.md'), `---
id: leftover-ask
name: Leftover Ask
description: reserved
argument-hint: x
target: rdc-agent
model: []
tools:
  - read
agents: []
handoffs: []
---

reserved
`, 'utf8');
    await writeFile(path.join(projectAgents, 'plan.agent.md'), `---
name: Plan
description: reserved
argument-hint: x
target: rdc-agent
model: []
tools:
  - read
agents: []
handoffs: []
---

reserved
`, 'utf8');
    const settings = agentManifestService.getSettings(
      { agentsPath, instructionsPath: path.join(root, 'RDC.md') },
      [],
      [],
      [],
      path.join(root, 'project'),
    );
    expect(settings.definitions.map((definition) => definition.id)).not.toContain('ask');
    expect(settings.definitions.map((definition) => definition.id)).not.toContain('plan');
    expect(settings.diagnostics.some((entry) => (
      entry.code === 'AGENT_ID_RESERVED_HISTORICAL' && entry.scope === 'user'
    ))).toBe(true);
    expect(settings.diagnostics.some((entry) => (
      entry.code === 'AGENT_ID_RESERVED_HISTORICAL' && entry.scope === 'project'
    ))).toBe(true);
    expect(fs.existsSync(path.join(projectAgents, 'plan.agent.md'))).toBe(true);
  });
});
