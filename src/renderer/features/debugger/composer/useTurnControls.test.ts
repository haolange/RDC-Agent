import { describe, expect, it } from 'vitest';
import type { ResolvedModelCapability } from '@shared/types/modelCapability';
import { buildInitialTurnControls } from './turnControlsUtils';
import {
  buildSessionTurnControlsKey,
  shouldResyncTurnControls,
} from './useTurnControls';

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
  toolCalling: true,
  visionInput: false,
  structuredOutput: true,
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
});
