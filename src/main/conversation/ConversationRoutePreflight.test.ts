import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings, LlmProviderEntry } from '@shared/types/settings';
import type { EffectiveModel } from '@shared/types/providerCapability';

vi.mock('../settings/SettingsService', () => ({
  settingsService: {
    getAll: vi.fn(),
  },
}));

vi.mock('../settings/AgentManifestService', () => ({
  agentManifestService: {
    getEffectiveProfiles: () => [{ id: 'edit', name: 'Edit', enabled: true }],
  },
}));

vi.mock('../settings/EffectiveModelResolver', () => ({
  resolveEffectiveModelSelection: vi.fn(),
}));

import { settingsService } from '../settings/SettingsService';
import { resolveEffectiveModelSelection } from '../settings/EffectiveModelResolver';
import { resolveAgentRoutePreflight } from './ConversationRoutePreflight';

const provider = {
  id: 'cline-pass',
  enabled: true,
  isConfigured: true,
  status: 'verified',
  protocol: 'OpenAICompatibleChatCompletions',
} as LlmProviderEntry;

function settingsWith(): AppSettings {
  return {
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
});
