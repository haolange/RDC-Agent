import { describe, expect, it } from 'vitest';
import { isHighImpactChannel, RENDERER_INVOKE_CHANNELS, resolveBridgeChannelCapability } from './channels';

describe('renderer invoke channel table', () => {
  it('gives every declared channel one of the four capabilities', () => {
    for (const channel of RENDERER_INVOKE_CHANNELS) {
      expect(['read', 'mutation', 'high-impact', 'desktop-only']).toContain(resolveBridgeChannelCapability(channel));
    }
  });

  it('fails closed for unknown channels', () => {
    expect(isHighImpactChannel('foo:launchNuclearMissile')).toBe(false);
    expect(() => resolveBridgeChannelCapability('foo:launchNuclearMissile')).toThrow(/BRIDGE_CAPABILITY_MISSING/);
  });
});
