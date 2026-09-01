import { describe, expect, it } from 'vitest';
import { MODE_CAPABILITIES, assignDefaultCaptureRoles } from './modes';

describe('modes', () => {
  it('exposes capability tables for product modes', () => {
    expect(MODE_CAPABILITIES.ask).toBeUndefined();
    expect(MODE_CAPABILITIES.general.profileId).toBe('general');
    expect(MODE_CAPABILITIES.debugger.availableStages.length).toBeGreaterThan(0);
    expect(MODE_CAPABILITIES.analyzer.isFullyImplemented).toBe(false);
    expect(MODE_CAPABILITIES.optimizer.disabledReason).toMatch(/not implemented/i);
  });

  it('assignDefaultCaptureRoles maps primary/baseline/reference', () => {
    expect(assignDefaultCaptureRoles(0)).toEqual([]);
    expect(assignDefaultCaptureRoles(1)).toEqual(['primary']);
    expect(assignDefaultCaptureRoles(2)).toEqual(['primary', 'baseline']);
    expect(assignDefaultCaptureRoles(4)).toEqual(['primary', 'baseline', 'reference', 'reference']);
  });
});
