import { describe, expect, it } from 'vitest';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { EffectiveModel } from '@shared/types/providerCapability';
import { buildInitialTurnControls } from '../../lib/turnControlsUtils';
import {
  buildSessionTurnControlsKey,
  resolveTurnControlsForCapabilityChange,
} from '../../lib/turnControlHelpers';

const limitedLevelsCapability: EffectiveModel = {
  providerId: 'deepseek',
  modelId: 'deepseek-v4-flash',
  label: 'DeepSeek', aliases: [], enabled: true,
  route: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://example.test', source: 'catalog' },
  availability: 'available',
  presencePolicy: 'maintained',
  contextTiers: [{ id: 'default', label: 'Default', maxPromptTokens: 128_000, activation: { kind: 'implicit' }, entitlement: 'granted' }],
  defaultBudgetTokens: 128_000,
  controls: {
    reasoning: {
      kind: 'levels',
      supportsOff: true,
      levels: ['high', 'max'],
      defaultSelection: 'high',
      wireProfile: { kind: 'none' },
    },
    fast: { state: 'unsupported', fixedValue: false },
    maxContext: { state: 'unsupported', fixedValue: false },
  },
  toolCalling: { state: 'supported' }, visionInput: { state: 'unsupported' }, structuredOutput: { state: 'supported' },
  provenance: [],
};

const noMaxCapability: EffectiveModel = {
  ...limitedLevelsCapability,
  providerId: 'openai',
  modelId: 'gpt-5.5',
  controls: {
    ...limitedLevelsCapability.controls,
    reasoning: {
      kind: 'levels',
      supportsOff: true,
      levels: ['low', 'medium', 'high', 'xhigh'],
      defaultSelection: 'medium',
      wireProfile: { kind: 'none' },
    },
  },
};

const maxControls: ConversationTurnControls = {
  reasoningLevel: 'max',
  maxContextMode: false,
  fastModel: false,
};

describe('useTurnControls sync guards', () => {
  it('restores session controls when the first committed capability resolves', () => {
    const persistedControls = {
      reasoningLevel: 'off',
      maxContextMode: false,
      fastModel: false,
    } as const;
    const sessionControlsKey = buildSessionTurnControlsKey(persistedControls);

    expect(sessionControlsKey).toBe('{"reasoningLevel":"off","maxContextMode":false,"fastModel":false}');
    expect(resolveTurnControlsForCapabilityChange({
      previousCapabilityKey: null,
      nextCapabilityKey: 'ask:deepseek:deepseek-v4-flash',
      sessionChanged: false,
      sessionControlsChanged: false,
      capability: limitedLevelsCapability,
      sessionControls: persistedControls,
      currentControls: buildInitialTurnControls(null),
      rememberedControls: undefined,
    })).toEqual({
      reasoningLevel: 'off',
      maxContextMode: false,
      fastModel: false,
    });
  });

  it('tracks only canonical reasoning values in the persisted session fingerprint', () => {
    expect(buildSessionTurnControlsKey({
      reasoningLevel: 'max',
      maxContextMode: true,
      fastModel: false,
    })).toBe('{"reasoningLevel":"max","maxContextMode":true,"fastModel":false}');
  });

  it('keeps session controls when capability first resolves', () => {
    const sessionControls = {
      reasoningLevel: 'off' as const,
      maxContextMode: false,
      fastModel: false,
    };
    expect(resolveTurnControlsForCapabilityChange({
      previousCapabilityKey: null,
      nextCapabilityKey: 'ask:deepseek:deepseek-v4-flash',
      sessionChanged: false,
      sessionControlsChanged: false,
      capability: limitedLevelsCapability,
      sessionControls,
      currentControls: buildInitialTurnControls(null),
      rememberedControls: undefined,
    })).toEqual({
      reasoningLevel: 'off',
      maxContextMode: false,
      fastModel: false,
    });
  });

  it('restores remembered controls when switching back to a model', () => {
    expect(resolveTurnControlsForCapabilityChange({
      previousCapabilityKey: 'ask:openai:gpt-5.5',
      nextCapabilityKey: 'ask:deepseek:deepseek-v4-flash',
      sessionChanged: false,
      sessionControlsChanged: false,
      capability: limitedLevelsCapability,
      sessionControls: { reasoningLevel: 'off', maxContextMode: false, fastModel: false },
      currentControls: {
        reasoningLevel: 'xhigh',
        maxContextMode: false,
        fastModel: false,
      },
      rememberedControls: maxControls,
    })).toEqual(maxControls);
  });

  it('retains user effort when metadata changes within the same model route', () => {
    const current = { reasoningLevel: 'low' as const, maxContextMode: false, fastModel: false };
    expect(resolveTurnControlsForCapabilityChange({
      previousCapabilityKey: 'general:provider:model:old-revision', nextCapabilityKey: 'general:provider:model:new-revision',
      sessionChanged: false, sessionControlsChanged: false, sameModelRoute: true,
      capability: noMaxCapability, sessionControls: null, currentControls: current, rememberedControls: undefined,
    })).toEqual(current);
  });

  it('keeps restored effort when session hydration selects another agent on the same provider route', () => {
    const selected = { reasoningLevel: 'low' as const, maxContextMode: false, fastModel: false };
    expect(resolveTurnControlsForCapabilityChange({ previousCapabilityKey: 'general:provider:model:revision', nextCapabilityKey: 'optimizer:provider:model:revision', sessionChanged: false, sessionControlsChanged: false, sameModelRoute: true, capability: noMaxCapability, sessionControls: selected, currentControls: selected, rememberedControls: undefined })).toEqual(selected);
  });

  it('restores the current selection after a temporary capability loading state', () => {
    const selected = { reasoningLevel: 'low' as const, maxContextMode: false, fastModel: false };
    expect(resolveTurnControlsForCapabilityChange({ previousCapabilityKey: null, nextCapabilityKey: 'route', sessionChanged: false, sessionControlsChanged: false, capability: noMaxCapability, sessionControls: null, currentControls: buildInitialTurnControls(null), rememberedControls: selected })).toEqual(selected);
  });

  it('uses model defaults instead of stale session controls on pure model switch', () => {
    expect(resolveTurnControlsForCapabilityChange({
      previousCapabilityKey: 'ask:deepseek:deepseek-v4-flash',
      nextCapabilityKey: 'ask:openai:gpt-5.5',
      sessionChanged: false,
      sessionControlsChanged: false,
      capability: noMaxCapability,
      sessionControls: maxControls,
      currentControls: maxControls,
      rememberedControls: undefined,
    })).toEqual({
      reasoningLevel: 'medium',
      maxContextMode: false,
      fastModel: false,
    });
  });

  it('clamps remembered max down when the target model has no max', () => {
    expect(resolveTurnControlsForCapabilityChange({
      previousCapabilityKey: 'ask:deepseek:deepseek-v4-flash',
      nextCapabilityKey: 'ask:openai:gpt-5.5',
      sessionChanged: false,
      sessionControlsChanged: false,
      capability: noMaxCapability,
      sessionControls: null,
      currentControls: maxControls,
      rememberedControls: maxControls,
    })).toEqual({
      reasoningLevel: 'xhigh',
      maxContextMode: false,
      fastModel: false,
    });
  });
});
