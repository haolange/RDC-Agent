import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, LlmProviderEntry } from '@shared/types/settings';
import type { EffectiveModel } from '@shared/types/providerCapability';

const { editProfile } = vi.hoisted(() => ({
  editProfile: {
    id: 'edit',
    name: 'Edit',
    enabled: true,
    compiledRoute: {
      agentId: 'edit',
      providerId: 'cline-pass',
      modelId: 'cline-pass/kimi-k2.7-code',
    },
  },
}));

vi.mock('../settings/SettingsService', () => ({
  settingsService: {
    getAll: vi.fn(),
  },
}));

vi.mock('../settings/AgentManifestService', () => ({
  agentManifestService: {
    getEffectiveProfiles: vi.fn(() => [editProfile]),
    resolveEffectiveSnapshot: vi.fn(() => ({ profiles: [editProfile], diagnostics: [] })),
  },
}));

vi.mock('../settings/EffectiveModelResolver', () => ({
  resolveEffectiveModelSelection: vi.fn(),
}));

vi.mock('../runtime/RuntimeLogService', () => ({
  runtimeLogService: { log: vi.fn() },
}));

import { settingsService } from '../settings/SettingsService';
import { agentManifestService } from '../settings/AgentManifestService';
import { resolveEffectiveModelSelection } from '../settings/EffectiveModelResolver';
import {
  findEffectiveAgentProfile,
  recordOverlayProfileDiagnostics,
  resolveAgentRoutePreflight,
  resolveConversationAgentId,
} from './ConversationRoutePreflight';
import { runtimeLogService } from '../runtime/RuntimeLogService';

const provider = {
  id: 'cline-pass',
  enabled: true,
  isConfigured: true,
  status: 'verified',
  protocol: 'OpenAICompatibleChatCompletions',
} as LlmProviderEntry;

function settingsWith(): AppSettings {
  return {
    paths: { agentsPath: 'C:/tmp/agents', userRdxRoot: 'C:/tmp/rdx' },
    llm: {
      providers: [provider],
      agentRoutes: [{ agentId: 'edit', providerId: 'cline-pass', modelId: 'cline-pass/kimi-k2.7-code' }],
    },
  } as unknown as AppSettings;
}

function model(state: 'supported' | 'unknown' | 'unsupported'): EffectiveModel {
  return {
    providerId: 'cline-pass',
    modelId: 'cline-pass/kimi-k2.7-code',
    label: 'Kimi K2.7 Code',
    aliases: [],
    enabled: true,
    availability: 'available',
    presencePolicy: 'account-entitled',
    contextTiers: [],
    defaultBudgetTokens: 200000,
    controls: {
      fast: { state: 'unsupported', fixedValue: false },
      maxContext: { state: 'unsupported', fixedValue: false },
      reasoning: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
    },
    route: { protocol: 'OpenAICompatibleChatCompletions', source: 'catalog' },
    toolCalling: { state },
    visionInput: { state: 'unknown' },
    structuredOutput: { state: 'unknown' },
    provenance: [],
    selection: { pickerVisibility: 'primary' },
  } as EffectiveModel;
}

describe('resolveAgentRoutePreflight tool eligibility', () => {
  afterEach(() => {
    vi.mocked(settingsService.getAll).mockReset();
    vi.mocked(resolveEffectiveModelSelection).mockReset();
    vi.mocked(agentManifestService.getEffectiveProfiles).mockClear();
    vi.mocked(agentManifestService.resolveEffectiveSnapshot).mockClear();
    vi.mocked(agentManifestService.resolveEffectiveSnapshot).mockReturnValue({
      profiles: [editProfile],
      diagnostics: [],
    } as never);
  });

  it('admits a source-backed supported model', () => {
    vi.mocked(settingsService.getAll).mockReturnValue(settingsWith());
    vi.mocked(resolveEffectiveModelSelection).mockReturnValue({
      requestedModelId: 'cline-pass/kimi-k2.7-code',
      model: model('supported'),
      recommendations: [],
    });
    const result = resolveAgentRoutePreflight('edit');
    expect(result.ok).toBe(true);
  });

  it('fails closed for unknown tool calling without silent fallback', () => {
    vi.mocked(settingsService.getAll).mockReturnValue(settingsWith());
    vi.mocked(resolveEffectiveModelSelection).mockReturnValue({
      requestedModelId: 'cline-pass/kimi-k2.7-code',
      model: model('unknown'),
      recommendations: [{ providerId: 'cline-pass', modelId: 'cline-pass/glm-5.3', label: 'GLM-5.3' }],
    });
    const result = resolveAgentRoutePreflight('edit');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe('CONVERSATION_LLM_TOOLS_UNAVAILABLE');
    expect(result.diagnostic.userMessage).toContain('尚未证实');
    expect(result.diagnostic.userMessage).not.toContain('明确不支持');
    expect(result.diagnostic.recommendations).toEqual([
      { providerId: 'cline-pass', modelId: 'cline-pass/glm-5.3', label: 'GLM-5.3' },
    ]);
  });

  it('fails closed for explicit unsupported tool calling', () => {
    vi.mocked(settingsService.getAll).mockReturnValue(settingsWith());
    vi.mocked(resolveEffectiveModelSelection).mockReturnValue({
      requestedModelId: 'cline-pass/kimi-k2.7-code',
      model: model('unsupported'),
      recommendations: [],
    });
    const result = resolveAgentRoutePreflight('edit');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe('CONVERSATION_LLM_TOOLS_UNAVAILABLE');
    expect(result.diagnostic.userMessage).toContain('明确不支持');
  });

  it('uses the project-scoped compiledRoute and ignores leftover user agentRoutes', () => {
    vi.mocked(settingsService.getAll).mockReturnValue({
      ...settingsWith(),
      llm: {
        providers: [provider],
        agentRoutes: [{ agentId: 'edit', providerId: 'retired-user', modelId: 'retired-model' }],
      },
    } as unknown as AppSettings);
    vi.mocked(resolveEffectiveModelSelection).mockReturnValue({
      requestedModelId: 'cline-pass/kimi-k2.7-code',
      model: model('supported'),
      recommendations: [],
    });
    const result = resolveAgentRoutePreflight('edit', undefined, null, 'D:/Project');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.providerId).toBe('cline-pass');
    expect(result.modelId).toBe('cline-pass/kimi-k2.7-code');
    expect(vi.mocked(agentManifestService.resolveEffectiveSnapshot)).toHaveBeenCalledWith(
      expect.anything(),
      'D:/Project',
    );
  });

  it('keeps a valid lower-scope profile and surfaces invalid high-scope overlay diagnostics', () => {
    vi.mocked(settingsService.getAll).mockReturnValue(settingsWith());
    vi.mocked(agentManifestService.resolveEffectiveSnapshot).mockReturnValue({
      profiles: [editProfile],
      diagnostics: [
        'PROJECT_AGENT_MANIFEST_INVALID: D:/Project/.rdx/agents/edit.agent.md: tools/skills/mcp-servers/agents/model must be string arrays when present.',
      ],
    } as never);
    vi.mocked(resolveEffectiveModelSelection).mockReturnValue({
      requestedModelId: 'cline-pass/kimi-k2.7-code',
      model: model('supported'),
      recommendations: [],
    });
    const result = resolveAgentRoutePreflight('edit', undefined, null, 'D:/Project');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overlayDiagnostics).toEqual([
      'PROJECT_AGENT_MANIFEST_INVALID: D:/Project/.rdx/agents/edit.agent.md: tools/skills/mcp-servers/agents/model must be string arrays when present.',
    ]);
  });

  it('attaches overlay invalid diagnostics on the blocked missing-route path', () => {
    vi.mocked(settingsService.getAll).mockReturnValue({
      ...settingsWith(),
      llm: { providers: [provider], agentRoutes: [] },
    } as unknown as AppSettings);
    vi.mocked(agentManifestService.resolveEffectiveSnapshot).mockReturnValue({
      profiles: [{
        id: 'edit',
        name: 'Edit',
        enabled: true,
        compiledRoute: { agentId: 'edit', providerId: '', modelId: '' },
      }],
      diagnostics: [
        'PROJECT_AGENT_MANIFEST_INVALID: D:/Project/.rdx/agents/edit.agent.md: tools/skills/mcp-servers/agents/model must be string arrays when present.',
      ],
    } as never);
    const result = resolveAgentRoutePreflight('edit', undefined, null, 'D:/Project');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe('CONVERSATION_LLM_ROUTE_MISSING');
    expect(result.overlayDiagnostics).toEqual([
      'PROJECT_AGENT_MANIFEST_INVALID: D:/Project/.rdx/agents/edit.agent.md: tools/skills/mcp-servers/agents/model must be string arrays when present.',
    ]);
  });

  it('records overlay invalid diagnostics on the blocked path', () => {
    vi.mocked(runtimeLogService.log).mockClear();
    recordOverlayProfileDiagnostics(
      { projectId: 'proj', session: null, currentRun: null } as never,
      'edit',
      ['PROJECT_AGENT_MANIFEST_INVALID: D:/Project/.rdx/agents/edit.agent.md: malformed'],
      false,
    );
    expect(vi.mocked(runtimeLogService.log)).toHaveBeenCalledWith(expect.objectContaining({
      raw: expect.objectContaining({ code: 'CONVERSATION_PROFILE_OVERLAY_INVALID' }),
      summary: expect.stringContaining('PROJECT_AGENT_MANIFEST_INVALID'),
    }));
  });

  it('reports disabled custom profiles without rewriting their id', () => {
    vi.mocked(settingsService.getAll).mockReturnValue(settingsWith());
    vi.mocked(agentManifestService.resolveEffectiveSnapshot).mockReturnValue({
      profiles: [{ id: 'ask', name: 'Ask', enabled: false }],
      diagnostics: [],
    } as never);
    expect(findEffectiveAgentProfile('ask', 'D:/Project')).toEqual({
      found: true,
      enabled: false,
      profile: { id: 'ask', name: 'Ask', enabled: false },
    });
    expect(vi.mocked(agentManifestService.resolveEffectiveSnapshot)).toHaveBeenCalledWith(
      expect.anything(),
      'D:/Project',
    );
  });
});

describe('resolveConversationAgentId', () => {
  afterEach(() => {
    vi.mocked(settingsService.getAll).mockReset();
    vi.mocked(agentManifestService.resolveEffectiveSnapshot).mockReset();
  });

  it('uses general only when both agentId and profileId are empty and general is enabled', () => {
    vi.mocked(settingsService.getAll).mockReturnValue(settingsWith());
    vi.mocked(agentManifestService.resolveEffectiveSnapshot).mockReturnValue({
      profiles: [{ id: 'general', name: 'General', enabled: true }],
      diagnostics: [],
    } as never);
    expect(resolveConversationAgentId(null, null, 'D:/Project')).toBe('general');
    expect(resolveConversationAgentId('  ', '', 'D:/Project')).toBe('general');
  });

  it('throws when a requested custom profile is disabled instead of rewriting to general', () => {
    vi.mocked(settingsService.getAll).mockReturnValue(settingsWith());
    vi.mocked(agentManifestService.resolveEffectiveSnapshot).mockReturnValue({
      profiles: [
        { id: 'general', name: 'General', enabled: true },
        { id: 'custom-disabled', name: 'Custom', enabled: false },
      ],
      diagnostics: [],
    } as never);
    let resolved: string | undefined;
    expect(() => {
      resolved = resolveConversationAgentId('custom-disabled', null, 'D:/Project');
    }).toThrow(/CONVERSATION_PROFILE_DISABLED: requested profile `custom-disabled` is disabled/);
    expect(resolved).toBeUndefined();
  });

  it('throws when a requested profile is absent from the project-aware snapshot', () => {
    vi.mocked(settingsService.getAll).mockReturnValue(settingsWith());
    vi.mocked(agentManifestService.resolveEffectiveSnapshot).mockReturnValue({
      profiles: [{ id: 'general', name: 'General', enabled: true }],
      diagnostics: [],
    } as never);
    expect(() => resolveConversationAgentId('ghost-reviewer', null, 'D:/Project')).toThrow(
      /CONVERSATION_PROFILE_UNKNOWN: requested profile `ghost-reviewer` is not in the project-aware snapshot/,
    );
    expect(vi.mocked(agentManifestService.resolveEffectiveSnapshot)).toHaveBeenCalledWith(
      expect.anything(),
      'D:/Project',
    );
  });

  it('fail-closes when even the default general profile is unavailable', () => {
    vi.mocked(settingsService.getAll).mockReturnValue(settingsWith());
    vi.mocked(agentManifestService.resolveEffectiveSnapshot).mockReturnValue({
      profiles: [{ id: 'general', name: 'General', enabled: false }],
      diagnostics: [],
    } as never);
    expect(() => resolveConversationAgentId(null, undefined, 'D:/Project')).toThrow(
      /CONVERSATION_AGENT_UNAVAILABLE: default profile `general` is not enabled/,
    );
  });
});
