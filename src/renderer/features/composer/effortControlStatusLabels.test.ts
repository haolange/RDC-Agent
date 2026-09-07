import { describe, expect, it } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import { buildEffortCapabilityStatusLabels } from './effortControlStatusLabels';

const capability = {
  controls: {
    maxContext: { state: 'fixed', fixedValue: true },
    fast: { state: 'unsupported', fixedValue: false },
  },
} as EffectiveModel;

const t = (key: string) => key;

describe('buildEffortCapabilityStatusLabels', () => {
  it('describes fixed-on and unsupported-off controls without hiding either row', () => {
    expect(buildEffortCapabilityStatusLabels({
      capability,
      capabilityReady: true,
      capabilityStateLabel: undefined,
      maxTierUnverified: false,
      fastUnverified: false,
      t,
    })).toEqual({
      maxContextStatusLabel: 'composer.effort.fixed',
      fastModelStatusLabel: 'composer.effort.unsupported',
    });
  });

  it('keeps both rows in the same loading state before capability resolution', () => {
    expect(buildEffortCapabilityStatusLabels({
      capability: null,
      capabilityReady: false,
      capabilityStateLabel: 'Loading capability',
      maxTierUnverified: false,
      fastUnverified: false,
      t,
    })).toEqual({
      maxContextStatusLabel: 'Loading capability',
      fastModelStatusLabel: 'Loading capability',
    });
  });
});
