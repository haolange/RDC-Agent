import { describe, expect, it } from 'vitest';
import type { ConversationTurnControls, ResolvedModelCapability } from '@shared/types/modelCapability';
import { buildInitialTurnControls } from './turnControlsUtils';
import {
  buildSessionTurnControlsKey,
  isPendingCapabilityKey,
  resolveTurnControlsForCapabilityChange,
  shouldResyncTurnControls,
} from './turnControlHelpers';

const limitedLevelsCapability: ResolvedModelCapability = {
  providerId: 'deepseek',
  modelId: 'deepseek-v4-flash',
  catalogSource: 'managed-catalog',
  nominalContextWindowTokens: 128_000,
  defaultContextWindowTokens: 128_000,
  maxContextWindowTokens: null,
  reasoningControl: {
    kind: 'levels',
    supportsOff: true,
    levels: ['high', 'max'],
    defaultSelection: 'high',
    wireProfile: { kind: 'none' },
  },
  maxContextAvailable: false,
  fastVariantModelId: null,
  fastModelAvailable: false,
  fixedTemperature: null,
  toolCalling: true,
  visionInput: false,
  structuredOutput: true,
};

const noMaxCapability: ResolvedModelCapability = {
  ...limitedLevelsCapability,
  providerId: 'openai',
  modelId: 'gpt-5.5',
  reasoningControl: {
    kind: 'levels',
    supportsOff: true,
    levels: ['low', 'medium', 'high', 'extra'],
    defaultSelection: 'medium',
    wireProfile: { kind: 'none' },
  },
};

const maxControls: ConversationTurnControls = {
  reasoningLevel: 'max',
  maxContextMode: false,
  fastModel: false,
};

describe('useTurnControls sync guards', () => {
  it('treats a capability resolution as a required resync even when the session is unchanged', () => {
    const persistedControls = {
      reasoningLevel: 'off',
      maxContextMode: false,
      fastModel: false,
    } as const;
    const sessionControlsKey = buildSessionTurnControlsKey(persistedControls);

    expect(shouldResyncTurnControls(
      {
        sessionId: 'sess_reload',
        capabilityKey: 'ask:pending',
        sessionControlsKey,
      },
      {
        sessionId: 'sess_reload',
        capabilityKey: 'ask:deepseek:deepseek-v4-flash',
        sessionControlsKey,
      },
    )).toBe(true);

    expect(buildInitialTurnControls(limitedLevelsCapability, persistedControls)).toEqual({
      reasoningLevel: 'off',
      maxContextMode: false,
      fastModel: false,
    });
  });

  it('tracks legacy effort values in the persisted session fingerprint', () => {
    expect(buildSessionTurnControlsKey({
      effort: 'extHigh',
      maxContextMode: true,
      fastModel: false,
    })).toContain('"effort":"extHigh"');
  });

  it('detects pending capability keys', () => {
    expect(isPendingCapabilityKey('ask:pending')).toBe(true);
    expect(isPendingCapabilityKey('ask:deepseek:deepseek-v4-flash')).toBe(false);
  });

  it('keeps session controls when capability first resolves from pending', () => {
    const sessionControls = {
      reasoningLevel: 'off' as const,
      maxContextMode: false,
      fastModel: false,
    };
    expect(resolveTurnControlsForCapabilityChange({
      previousCapabilityKey: 'ask:pending',
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
        reasoningLevel: 'extra',
        maxContextMode: false,
        fastModel: false,
      },
      rememberedControls: maxControls,
    })).toEqual(maxControls);
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
      reasoningLevel: 'extra',
      maxContextMode: false,
      fastModel: false,
    });
  });
});
