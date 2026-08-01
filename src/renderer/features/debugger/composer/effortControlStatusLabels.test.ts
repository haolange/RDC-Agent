import { describe, expect, it } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import { buildEffortCapabilityStatusLabels } from './effortControlStatusLabels';

const capability = {
  controls: {
    context1m: { state: 'fixed', fixedValue: true },
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
      oneMillionUnverified: false,
      fastUnverified: false,
      t,
    })).toEqual({
      oneMillionContextStatusLabel: 'composer.effort.fixed',
      fastModelStatusLabel: 'composer.effort.unsupported',
    });
  });

  it('keeps both rows in the same loading state before capability resolution', () => {
    expect(buildEffortCapabilityStatusLabels({
      capability: null,
      capabilityReady: false,
      capabilityStateLabel: 'Loading capability',
      oneMillionUnverified: false,
      fastUnverified: false,
      t,
    })).toEqual({
      oneMillionContextStatusLabel: 'Loading capability',
      fastModelStatusLabel: 'Loading capability',
    });
  });
});
