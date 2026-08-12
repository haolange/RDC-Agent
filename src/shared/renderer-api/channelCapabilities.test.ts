import { describe, expect, it } from 'vitest';
import { RENDERER_INVOKE_CHANNELS } from './channels';
import {
  CHANNEL_CAPABILITY,
  assertChannelCapabilityCoverage,
  hasBridgeChannelCapability,
  listUnclassifiedInvokeChannels,
  resolveBridgeChannelCapability,
} from './channelCapabilities';

describe('channelCapabilities closed map', () => {
  it('classifies every renderer invoke channel with no fallback', () => {
    expect(listUnclassifiedInvokeChannels()).toEqual([]);
    expect(Object.keys(CHANNEL_CAPABILITY).sort()).toEqual([...RENDERER_INVOKE_CHANNELS].sort());
    assertChannelCapabilityCoverage();
    for (const channel of RENDERER_INVOKE_CHANNELS) {
      expect(hasBridgeChannelCapability(channel)).toBe(true);
      expect(['read', 'mutation', 'high-impact', 'desktop-only']).toContain(
        resolveBridgeChannelCapability(channel),
      );
    }
  });

  it('fails closed for unknown channels', () => {
    expect(hasBridgeChannelCapability('foo:launchNuclearMissile')).toBe(false);
    expect(() => resolveBridgeChannelCapability('foo:launchNuclearMissile')).toThrow(/BRIDGE_CAPABILITY_MISSING/);
  });
});
